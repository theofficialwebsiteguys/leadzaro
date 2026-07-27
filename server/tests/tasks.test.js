'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Project, Task, TimeEntry, Notification,
} = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');

afterAll(async () => {
  await sequelize.close();
});

async function setupAgencyWithClientProject() {
  const agency = await createOrganization(sequelize.models, { type: 'agency' });
  const clientOrg = await createOrganization(sequelize.models, { type: 'client', managingAgencyOrganizationId: agency.id });
  const project = await Project.create({
    organizationId: clientOrg.id, agencyOrganizationId: agency.id, stage: 'Design', healthStatus: 'on_track',
  });
  return { agency, clientOrg, project };
}

describe('Task visibility guard', () => {
  test('a raw, unscoped Task query throws', async () => {
    await expect(Task.findAll()).rejects.toThrow(/must be queried through/i);
  });
});

describe('Tasks: client visibility boundary', () => {
  test('a client never sees an internal (isClientVisible: false) task, only client-visible ones', async () => {
    const { agency, clientOrg, project } = await setupAgencyWithClientProject();
    const internalTask = await Task.create({
      projectId: project.id, organizationId: clientOrg.id, agencyOrganizationId: agency.id, title: 'Internal dev note', isClientVisible: false,
    });
    const visibleTask = await Task.create({
      projectId: project.id, organizationId: clientOrg.id, agencyOrganizationId: agency.id, title: 'Client-facing milestone', isClientVisible: true,
    });

    const { user, password } = await createRoleAssignedMember(sequelize.models, {
      organizationId: clientOrg.id, roleKeys: ['client_owner'], membershipType: 'client',
    });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const list = await auth(request(app).get(`/api/v1/projects/${project.id}/tasks`));
    expect(list.status).toBe(200);
    const ids = list.body.data.tasks.map((t) => t.id);
    expect(ids).toContain(visibleTask.id);
    expect(ids).not.toContain(internalTask.id);

    const directGetInternal = await auth(request(app).get(`/api/v1/projects/${project.id}/tasks/${internalTask.id}`));
    expect(directGetInternal.status).toBe(404);

    const directGetVisible = await auth(request(app).get(`/api/v1/projects/${project.id}/tasks/${visibleTask.id}`));
    expect(directGetVisible.status).toBe(200);
  });

  test('an employee at the owning agency sees every task on their agency\'s project, internal or not', async () => {
    const { agency, clientOrg, project } = await setupAgencyWithClientProject();
    const internalTask = await Task.create({
      projectId: project.id, organizationId: clientOrg.id, agencyOrganizationId: agency.id, title: 'Internal dev note', isClientVisible: false,
    });

    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['designer'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const get = await auth(request(app).get(`/api/v1/projects/${project.id}/tasks/${internalTask.id}`));
    expect(get.status).toBe(200);
    expect(get.body.data.task.isClientVisible).toBe(false);
  });

  test('a task cannot be created against a project belonging to a different agency', async () => {
    const { project: projectA } = await setupAgencyWithClientProject();
    const { agency: agencyB } = await setupAgencyWithClientProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyB.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const res = await auth(request(app).post(`/api/v1/projects/${projectA.id}/tasks`).send({ title: 'Should not be creatable' }));
    expect(res.status).toBe(404);
  });
});

describe('Tasks: CRUD and subtasks', () => {
  test('tasks.manage is required to create/update/archive a task', async () => {
    const { agency, project } = await setupAgencyWithClientProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['sales_representative'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const res = await auth(request(app).post(`/api/v1/projects/${project.id}/tasks`).send({ title: 'Nope' }));
    expect(res.status).toBe(403);
  });

  test('a subtask must belong to the same project as its parent', async () => {
    const { agency, project } = await setupAgencyWithClientProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const parent = await auth(request(app).post(`/api/v1/projects/${project.id}/tasks`).send({ title: 'Parent task' }));
    expect(parent.status).toBe(201);

    const child = await auth(request(app).post(`/api/v1/projects/${project.id}/tasks`).send({ title: 'Subtask', parentTaskId: parent.body.data.task.id }));
    expect(child.status).toBe(201);
    expect(child.body.data.task.parentTaskId).toBe(parent.body.data.task.id);

    const { project: otherProject } = await setupAgencyWithClientProject();
    const crossParent = await Task.create({
      projectId: otherProject.id, organizationId: otherProject.organizationId, agencyOrganizationId: otherProject.agencyOrganizationId, title: 'Cross-project parent',
    });
    const invalidChild = await auth(request(app).post(`/api/v1/projects/${project.id}/tasks`).send({ title: 'Bad subtask', parentTaskId: crossParent.id }));
    expect(invalidChild.status).toBe(404);
  });

  test('updating status/priority validates against the known catalog', async () => {
    const { agency, project } = await setupAgencyWithClientProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const created = await auth(request(app).post(`/api/v1/projects/${project.id}/tasks`).send({ title: 'Task' }));
    const badStatus = await auth(request(app).patch(`/api/v1/projects/${project.id}/tasks/${created.body.data.task.id}`).send({ status: 'not_a_real_status' }));
    expect(badStatus.status).toBe(422);

    const goodStatus = await auth(request(app).patch(`/api/v1/projects/${project.id}/tasks/${created.body.data.task.id}`).send({ status: 'in_progress' }));
    expect(goodStatus.status).toBe(200);
    expect(goodStatus.body.data.task.status).toBe('in_progress');
  });

  test('archiving removes a task from the default list', async () => {
    const { agency, project } = await setupAgencyWithClientProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const created = await auth(request(app).post(`/api/v1/projects/${project.id}/tasks`).send({ title: 'To be archived' }));
    await auth(request(app).post(`/api/v1/projects/${project.id}/tasks/${created.body.data.task.id}/archive`));

    const list = await auth(request(app).get(`/api/v1/projects/${project.id}/tasks`));
    expect(list.body.data.tasks.map((t) => t.id)).not.toContain(created.body.data.task.id);
  });
});

describe('Task assignment notifications', () => {
  test('assigning a task to a new user notifies them; re-saving without changing assignee does not notify again', async () => {
    const { agency, project } = await setupAgencyWithClientProject();
    const { user: pm, password: pmPassword } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['project_manager'] });
    const { user: dev } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, pm.email, pmPassword);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const created = await auth(request(app).post(`/api/v1/projects/${project.id}/tasks`).send({ title: 'Assign me' }));
    const taskId = created.body.data.task.id;

    const assigned = await auth(request(app).patch(`/api/v1/projects/${project.id}/tasks/${taskId}`).send({ assigneeUserId: dev.id }));
    expect(assigned.status).toBe(200);

    const notifications = await Notification.findAll({ where: { userId: dev.id, type: 'task_assigned' } });
    expect(notifications.length).toBe(1);
    expect(notifications[0].data.taskId).toBe(taskId);

    await auth(request(app).patch(`/api/v1/projects/${project.id}/tasks/${taskId}`).send({ priority: 'high' }));
    const stillOne = await Notification.findAll({ where: { userId: dev.id, type: 'task_assigned' } });
    expect(stillOne.length).toBe(1);
  });
});

describe('Time entries', () => {
  test('logging time requires a positive minutes value, and is scoped to the task', async () => {
    const { agency, project } = await setupAgencyWithClientProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agency.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const created = await auth(request(app).post(`/api/v1/projects/${project.id}/tasks`).send({ title: 'Timed task' }));
    const taskId = created.body.data.task.id;

    const invalidLog = await auth(request(app).post(`/api/v1/projects/${project.id}/tasks/${taskId}/time-entries`).send({ minutes: 0 }));
    expect(invalidLog.status).toBe(422);

    const validLog = await auth(request(app).post(`/api/v1/projects/${project.id}/tasks/${taskId}/time-entries`).send({ minutes: 45, note: 'Initial build' }));
    expect(validLog.status).toBe(201);

    const list = await auth(request(app).get(`/api/v1/projects/${project.id}/tasks/${taskId}/time-entries`));
    expect(list.status).toBe(200);
    expect(list.body.data.timeEntries.length).toBe(1);
    expect(list.body.data.timeEntries[0].minutes).toBe(45);

    const entryCount = await TimeEntry.count({ where: { taskId } });
    expect(entryCount).toBe(1);
  });
});

describe('Cross-agency isolation for tasks', () => {
  test('an employee at one agency cannot see or act on another agency\'s tasks', async () => {
    const { project: projectA } = await setupAgencyWithClientProject();
    const taskA = await Task.create({
      projectId: projectA.id, organizationId: projectA.organizationId, agencyOrganizationId: projectA.agencyOrganizationId, title: 'Agency A task',
    });
    const { agency: agencyB } = await setupAgencyWithClientProject();
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyB.id, roleKeys: ['developer'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const res = await auth(request(app).get(`/api/v1/projects/${projectA.id}/tasks/${taskA.id}`));
    expect(res.status).toBe(404);
  });
});
