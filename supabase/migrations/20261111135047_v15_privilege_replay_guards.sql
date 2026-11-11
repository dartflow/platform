-- Replaying the original bootstrap must never widen later v15 privileges.
-- Repair only runtime grants; no business rows or schema version are changed.
revoke update,delete on dartflow_private.platform_receipts,dartflow_private.platform_audit,dartflow_private.platform_signals from dartflow_app;
revoke update,delete on dartflow_private.platform_reports from dartflow_app;
grant update(status,decision,reviewed_by) on dartflow_private.platform_reports to dartflow_app;
revoke delete on dartflow_private.platform_cast_grants,dartflow_private.platform_registrations from dartflow_app;
revoke all on dartflow_private.owner_bootstrap from dartflow_app;
drop policy if exists server_runtime on dartflow_private.owner_bootstrap;
