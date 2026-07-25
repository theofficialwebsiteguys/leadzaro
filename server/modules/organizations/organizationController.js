const { success } = require('../../utils/response');

function getCurrent(req, res) {
  return success(res, {
    organization: {
      id: req.context.organization.id,
      name: req.context.organization.name,
      slug: req.context.organization.slug,
      type: req.context.organization.type,
    },
    membership: {
      id: req.context.membership.id,
      membershipType: req.context.membership.membershipType,
      title: req.context.membership.title,
    },
    permissions: Array.from(req.context.permissionKeys),
    availableMemberships: req.context.availableMemberships,
  });
}

module.exports = { getCurrent };
