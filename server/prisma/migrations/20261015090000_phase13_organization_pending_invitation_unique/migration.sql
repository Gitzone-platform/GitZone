-- Enforce at most one pending invitation per organization and invitee.
-- Expired pending invitations can be renewed by updating the existing row.
CREATE UNIQUE INDEX "OrganizationInvitation_one_pending_per_invitee"
ON "OrganizationInvitation" ("organizationId", "inviteeId")
WHERE "status" = 'PENDING';
