-- The administrator-direct registration path uses its own approval policy so
-- it remains separate from independently reviewed AI approvals. Preserve the
-- existing AI policy while allowing the new direct policy in the same queue.

alter table public.standard_product_link_approvals
  drop constraint if exists standard_product_link_approvals_approval_policy_check;

alter table public.standard_product_link_approvals
  add constraint standard_product_link_approvals_approval_policy_check
  check (
    approval_policy in (
      'authenticated_admin_explicit_second_step',
      'authenticated_admin_direct_registration'
    )
  );
