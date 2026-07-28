const sequelize = require('../config/database');

const User = require('./User')(sequelize);
const Lead = require('./Lead')(sequelize);
const SavedLead = require('./SavedLead')(sequelize);
const LeadNote = require('./LeadNote')(sequelize);
const OutreachActivity = require('./OutreachActivity')(sequelize);
const SubscriptionPlan = require('./SubscriptionPlan')(sequelize);
const UserSubscription = require('./UserSubscription')(sequelize);

const Organization = require('./Organization')(sequelize);
const OrganizationMembership = require('./OrganizationMembership')(sequelize);
const Role = require('./Role')(sequelize);
const Permission = require('./Permission')(sequelize);
const RolePermission = require('./RolePermission')(sequelize);
const MembershipRole = require('./MembershipRole')(sequelize);
const MembershipPermissionOverride = require('./MembershipPermissionOverride')(sequelize);
const Invitation = require('./Invitation')(sequelize);
const AuthSession = require('./AuthSession')(sequelize);
const AuditLog = require('./AuditLog')(sequelize);
const Notification = require('./Notification')(sequelize);
const NotificationPreference = require('./NotificationPreference')(sequelize);
const PasswordResetToken = require('./PasswordResetToken')(sequelize);
const EmailVerificationToken = require('./EmailVerificationToken')(sequelize);

const Opportunity = require('./Opportunity')(sequelize);
const Contact = require('./Contact')(sequelize);
const Location = require('./Location')(sequelize);
const WebsiteAudit = require('./WebsiteAudit')(sequelize);
const InboundSubmission = require('./InboundSubmission')(sequelize);
const Enrichment = require('./Enrichment')(sequelize);

const ServicePlan = require('./ServicePlan')(sequelize);
const WebhookEvent = require('./WebhookEvent')(sequelize);
const PaymentLinkRequest = require('./PaymentLinkRequest')(sequelize);
const ConversionAttempt = require('./ConversionAttempt')(sequelize);
const BillingAccount = require('./BillingAccount')(sequelize);
const Subscription = require('./Subscription')(sequelize);

const Project = require('./Project')(sequelize);
const ProjectAssignment = require('./ProjectAssignment')(sequelize);
const ProjectFinancials = require('./ProjectFinancials')(sequelize);
const Task = require('./Task')(sequelize);
const TimeEntry = require('./TimeEntry')(sequelize);
const ProjectChannel = require('./ProjectChannel')(sequelize);
const Message = require('./Message')(sequelize);
const ClientRequest = require('./ClientRequest')(sequelize);
const ContentInboxItem = require('./ContentInboxItem')(sequelize);
const Meeting = require('./Meeting')(sequelize);
const File = require('./File')(sequelize);
const CancellationRequest = require('./CancellationRequest')(sequelize);

const DesignSystem = require('./DesignSystem')(sequelize);
const Website = require('./Website')(sequelize);
const WebsiteVersion = require('./WebsiteVersion')(sequelize);
const SectionDefinition = require('./SectionDefinition')(sequelize);
const WebsiteEditorAssignment = require('./WebsiteEditorAssignment')(sequelize);
const WebsiteComment = require('./WebsiteComment')(sequelize);
const WebsiteEditLock = require('./WebsiteEditLock')(sequelize);
const WebsitePresence = require('./WebsitePresence')(sequelize);
const WebsiteRepository = require('./WebsiteRepository')(sequelize);
const WebsiteDeployment = require('./WebsiteDeployment')(sequelize);
const WebsiteDevelopmentHandoff = require('./WebsiteDevelopmentHandoff')(sequelize);
const WebsiteDomain = require('./WebsiteDomain')(sequelize);
const WebsitePublicFormSubmission = require('./WebsitePublicFormSubmission')(sequelize);
const WebsiteAnalyticsEvent = require('./WebsiteAnalyticsEvent')(sequelize);

const models = {
  User,
  Lead,
  SavedLead,
  LeadNote,
  OutreachActivity,
  SubscriptionPlan,
  UserSubscription,
  Organization,
  OrganizationMembership,
  Role,
  Permission,
  RolePermission,
  MembershipRole,
  MembershipPermissionOverride,
  Invitation,
  AuthSession,
  AuditLog,
  Notification,
  NotificationPreference,
  PasswordResetToken,
  EmailVerificationToken,
  Opportunity,
  Contact,
  Location,
  WebsiteAudit,
  InboundSubmission,
  Enrichment,
  ServicePlan,
  WebhookEvent,
  PaymentLinkRequest,
  ConversionAttempt,
  BillingAccount,
  Subscription,
  Project,
  ProjectAssignment,
  ProjectFinancials,
  Task,
  TimeEntry,
  ProjectChannel,
  Message,
  ClientRequest,
  ContentInboxItem,
  Meeting,
  File,
  CancellationRequest,
  DesignSystem,
  Website,
  WebsiteVersion,
  SectionDefinition,
  WebsiteEditorAssignment,
  WebsiteComment,
  WebsiteEditLock,
  WebsitePresence,
  WebsiteRepository,
  WebsiteDeployment,
  WebsiteDevelopmentHandoff,
  WebsiteDomain,
  WebsitePublicFormSubmission,
  WebsiteAnalyticsEvent,
};

// Run associations
Object.values(models).forEach((model) => {
  if (model.associate) model.associate(models);
});

module.exports = { sequelize, ...models };
