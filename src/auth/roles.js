/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Role groupings used by the auth layer.

// Must have TOTP enrolled before they can use the product at all.
const MANDATORY_2FA_ROLES = new Set(['platform_owner', 'platform_admin']);

// May self-enrol; a school can additionally make it required (School.require_admin_2fa).
const SCHOOL_ADMIN_ROLES = new Set(['super_admin', 'head_teacher']);

module.exports = { MANDATORY_2FA_ROLES, SCHOOL_ADMIN_ROLES };
