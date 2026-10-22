const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Opportunity = sequelize.define('Opportunity', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // The prospect Organization this opportunity belongs to.
    organizationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    // Denormalized from Organization.managingAgencyOrganizationId at
    // creation time. Every authorization/query scope on this table uses
    // this column, matching the already-reviewed-and-tested pattern
    // SavedLead/LeadNote/OutreachActivity use for their own
    // organizationId — never a join through the prospect organization,
    // which nothing in a single-agency test suite would catch if wrong.
    agencyOrganizationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    // The canonical Google Places record this opportunity originated
    // from, if any (manually-created opportunities may have none).
    sourceLeadId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    stage: {
      type: DataTypes.STRING(40),
      allowNull: false,
    },
    assignedToUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    score: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    scoreReason: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    archivedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    deletedByUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    // Set when this opportunity was merged away as a duplicate — points
    // at the surviving ("winner") opportunity. Merging archives, it never
    // deletes; this column plus the merge AuditLog entry are what
    // undo-merge uses to reverse the operation.
    mergedIntoOpportunityId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    // Sales workflow (ADR 0011). Next action, archive and do-not-contact are
    // independent of stage; creditedUserId is fixed when the sale is paid.
    title: { type: DataTypes.STRING(200), allowNull: true },
    valueCents: { type: DataTypes.INTEGER, allowNull: true },
    currency: { type: DataTypes.STRING(3), allowNull: true },
    nextActionAt: { type: DataTypes.DATE, allowNull: true },
    nextActionType: { type: DataTypes.STRING(30), allowNull: true },
    nextActionNote: { type: DataTypes.STRING(500), allowNull: true },
    lastInteractionAt: { type: DataTypes.DATE, allowNull: true },
    lastInteractionSummary: { type: DataTypes.STRING(255), allowNull: true },
    replyNeededSince: { type: DataTypes.DATE, allowNull: true },
    doNotContact: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    doNotContactAt: { type: DataTypes.DATE, allowNull: true },
    doNotContactReason: { type: DataTypes.STRING(255), allowNull: true },
    lostReason: { type: DataTypes.STRING(255), allowNull: true },
    legacyStage: { type: DataTypes.STRING(40), allowNull: true },
    stageChangedAt: { type: DataTypes.DATE, allowNull: true },
    wonAt: { type: DataTypes.DATE, allowNull: true },
    creditedUserId: { type: DataTypes.UUID, allowNull: true },
    createdByUserId: { type: DataTypes.UUID, allowNull: true },
    primaryContactId: { type: DataTypes.UUID, allowNull: true },
    isTest: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    // Qualification (ADR 0013), collected progressively; only some stages require it.
    qualNeed: { type: DataTypes.TEXT, allowNull: true },
    qualService: { type: DataTypes.STRING(200), allowNull: true },
    qualDecisionMaker: { type: DataTypes.STRING(200), allowNull: true },
    qualTiming: { type: DataTypes.STRING(200), allowNull: true },
    qualBudget: { type: DataTypes.STRING(200), allowNull: true },
    closeReasonCode: { type: DataTypes.STRING(30), allowNull: true },
    // Why we're reaching out, and what supports it (ADR 0014); the unsent email draft.
    outreachReason: { type: DataTypes.TEXT, allowNull: true },
    outreachEvidence: { type: DataTypes.TEXT, allowNull: true },
    emailDraft: { type: DataTypes.JSONB, allowNull: true },
    // Guided workflow (ADR 0016). Each concept is its own field: qualification
    // progress and who did it, interest, meeting, pricing, payment
    // confirmation and closing approval.
    qualificationStatus: { type: DataTypes.STRING(20), allowNull: true },
    researcherUserId: { type: DataTypes.UUID, allowNull: true },
    qualifiedByUserId: { type: DataTypes.UUID, allowNull: true },
    qualifiedAt: { type: DataTypes.DATE, allowNull: true },
    qualificationNote: { type: DataTypes.STRING(500), allowNull: true },
    research: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    interestLevel: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'unknown' },
    meeting: { type: DataTypes.JSONB, allowNull: true },
    proposal: { type: DataTypes.JSONB, allowNull: true },
    paymentConfirmedAt: { type: DataTypes.DATE, allowNull: true },
    closingStatus: { type: DataTypes.STRING(20), allowNull: true },
    closingSubmittedAt: { type: DataTypes.DATE, allowNull: true },
    closingSubmittedByUserId: { type: DataTypes.UUID, allowNull: true },
    closingNote: { type: DataTypes.TEXT, allowNull: true },
    closingReviewedAt: { type: DataTypes.DATE, allowNull: true },
    closingReviewedByUserId: { type: DataTypes.UUID, allowNull: true },
    closingReviewNote: { type: DataTypes.STRING(500), allowNull: true },
    closingException: { type: DataTypes.STRING(500), allowNull: true },
    clientManagerUserId: { type: DataTypes.UUID, allowNull: true },
    // Sales accepting a qualifier's handoff (ADR 0017), apart from the qualifier completing it.
    salesAcceptedAt: { type: DataTypes.DATE, allowNull: true },
    salesAcceptedByUserId: { type: DataTypes.UUID, allowNull: true },
  }, {
    indexes: [
      {
        unique: true,
        fields: ['agencyOrganizationId', 'sourceLeadId'],
        where: { archivedAt: null, deletedAt: null },
        name: 'opportunities_agency_lead_active_unique',
      },
    ],
  });

  Opportunity.associate = (models) => {
    Opportunity.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
    Opportunity.belongsTo(models.Lead, { foreignKey: 'sourceLeadId', as: 'sourceLead' });
    Opportunity.belongsTo(models.User, { foreignKey: 'assignedToUserId', as: 'assignedTo' });
    Opportunity.belongsTo(models.Opportunity, { foreignKey: 'mergedIntoOpportunityId', as: 'mergedInto' });
    Opportunity.hasOne(models.WebsiteAudit, { foreignKey: 'opportunityId', as: 'websiteAudit' });
    Opportunity.hasOne(models.InboundSubmission, { foreignKey: 'opportunityId', as: 'inboundSubmission' });
    Opportunity.hasOne(models.Enrichment, { foreignKey: 'opportunityId', as: 'enrichment' });
    Opportunity.hasMany(models.PaymentLinkRequest, { foreignKey: 'opportunityId', as: 'paymentLinkRequests' });
    Opportunity.hasMany(models.ConversionAttempt, { foreignKey: 'opportunityId', as: 'conversionAttempts' });
    Opportunity.hasMany(models.OutreachActivity, { foreignKey: 'opportunityId', as: 'activities' });
    Opportunity.hasMany(models.SalesPayment, { foreignKey: 'opportunityId', as: 'payments' });
    Opportunity.hasOne(models.SalesHandoff, { foreignKey: 'opportunityId', as: 'handoff' });
    Opportunity.belongsTo(models.User, { foreignKey: 'creditedUserId', as: 'creditedTo' });
    Opportunity.belongsTo(models.User, { foreignKey: 'researcherUserId', as: 'researcher' });
    Opportunity.belongsTo(models.User, { foreignKey: 'qualifiedByUserId', as: 'qualifiedBy' });
    Opportunity.belongsTo(models.User, { foreignKey: 'closingSubmittedByUserId', as: 'closingSubmittedBy' });
    Opportunity.belongsTo(models.User, { foreignKey: 'closingReviewedByUserId', as: 'closingReviewedBy' });
    Opportunity.belongsTo(models.User, { foreignKey: 'clientManagerUserId', as: 'clientManager' });
    Opportunity.hasOne(models.WorkCredit, { foreignKey: 'opportunityId', as: 'qualificationCredit', scope: { kind: 'qualification' } });
  };

  return Opportunity;
};
