# ChiiTech Authenticated E2E Test Scenarios (No Supabase Pro Required)

## Test Environment Setup
- **Required**: 4 test accounts with different roles
- **Test accounts needed**:
  1. Super Admin: igbanichiobiebere@gmail.com (password managed by Supabase Auth)
  2. Company Admin: test@company-a.com with full access
  3. Worker: test-worker@company-a.com with specific departments
  4. Auditor: test-auditor@company-a.com with invitation token

## Test Scenarios

### 1. Login and Session Management
- [ ] Test company admin login with valid credentials
- [ ] Test worker login with invitation code
- [ ] Test auditor login with invitation code and access code
- [ ] Verify session persistence across page reloads
- [ ] Test session expiration and re-authentication
- [ ] Test that invalid credentials return appropriate error

### 2. Role-Based Access Control

#### Super Admin
- [ ] Can access platform overview console
- [ ] Can use `platform_overview()` RPC
- [ ] Can call `ensure_super_admin()` RPC (email-gated)
- [ ] Cannot access another company's data through frontend
- [ ] Can change own password via `supabase.auth.updateUser()`

#### Company Admin
- [ ] Can access own company's dashboard
- [ ] Can manage team members and departments
- [ ] Can view billing and subscription info
- [ ] Cannot access another company's data
- [ ] Can invite new workers/auditors via invitation codes
- [ ] Can revoke worker/auditor access

#### Worker
- [ ] Can access only sections listed in their departments
- [ ] Can add/edit own company's data (products, sales, expenses, etc.)
- [ ] Cannot access sections outside their departments
- [ ] Can join company via invitation code
- [ ] Cannot access another company's data even with URL manipulation

#### Auditor
- [ ] Can access Auditor Command Center via invitation
- [ ] Read-only access to company data
- [ ] Cannot write/modify any data
- [ ] Auditor visits are logged in `audit_visit_log`
- [ ] Auditor access expires per `expires_at` in `auditor_grants`

### 3. Cross-Company Data Isolation
- [ ] **Critical**: Test that user from Company A cannot:
  - [ ] Read Company B's products, sales, customers
  - [ ] Modify Company B's records
  - [ ] Access Company B's audit logs
  - [ ] View Company B's dashboard
- [ ] Verify this isolation is enforced by RLS policies, not just frontend hiding
- [ ] Test with different browser sessions/logins

### 4. Business Data Operations
- [ ] **Products**: Add, edit, delete products within company
- [ ] **Sales**: Create sales records, view sales history
- [ ] **Expenses**: Log expenses, flag suspicious entries
- [ ] **Customers**: Add/edit customers, view customer history
- [ ] **Orders**: Create orders, view order history
- [ ] **Debts**: Record debts, track settlement status
- [ ] **Audit Log**: Verify append-only nature (cannot edit/delete entries)

### 5. AI Assistant Tests
- [ ] **Chat mode**: Send questions, verify responses are company-scoped
- [ ] **Import analysis**: Stage a small CSV, verify analysis appears before commit
- [ ] **Import commit**: Commit staged rows to intended table only
- [ ] **Quota check**: Verify AI quota system responds appropriately
- [ ] **Greeting test**: Send "hi/hello/hey" - should return natural greeting without inference

### 6. Invitations and Team Management
- [ ] **Worker invitation**: Admin invites worker via code, worker accepts
- [ ] **Auditor invitation**: Admin invites auditor via code and access code
- [ ] **Invitation expiry**: Test that expired codes are rejected
- [ ] **Invitation reuse**: Test that used codes cannot be reused
- [ ] **Department assignment**: Admin assigns departments to workers

### 7. Profile and Security Settings
- [ ] **Profile update**: Update name, role, departments
- [ ] **Password change**: Change password via Supabase Auth (works without Pro plan)
- [ ] **Security settings**: View connected sessions, revoke active sessions
- [ ] **Two-factor**: If applicable, test 2FA flow

### 8. Reports and Exports
- [ ] **Report generation**: Generate business reports (financial, audit, etc.)
- [ ] **Data export**: Export data in appropriate format
- [ ] **Check that exports contain only company's data**

### 9. Mobile Responsiveness
- [ ] Test all above scenarios at 360px width
- [ ] Verify keyboard guard for AI composer on mobile
- [ ] Verify safe-area insets work with `viewport-fit=cover`
- [ ] Verify navigation hides when keyboard is open

### 10. Error Handling
- [ ] Test invalid inputs across all forms
- [ ] Test network failures during API calls
- [ ] Test session expiration mid-session
- [ ] Test role escalation attempts

## Test Data Requirements

### Test Companies:
- **Company A**: Admin + Worker + Auditor (for isolation testing)
- **Company B**: Separate company (for cross-company isolation)
- **Test users**: Must have valid profiles with active status

### Test Scenarios That CANNOT Be Tested (Require Supabase Pro):
- Leaked-password protection (HTTP 402 error)
- Any dashboard/billing features that require Supabase Pro subscription

## Success Criteria

All tests pass when:
1. ✅ All roles can perform their authorized functions
2. ✅ No cross-company data access is possible
3. ✅ AI assistant responds with company-scoped data
4. ✅ Invitations work correctly (create, accept, expire, revoke)
5. ✅ Data isolation is enforced by RLS, not just frontend hiding
6. ✅ All major workflows complete without errors
7. ✅ Mobile view functions correctly at 360px

Note: Tests 3-7 from the "CANNOT Be Tested" list require Supabase Pro and are marked as owner-dependent items from the audit.