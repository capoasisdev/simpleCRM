-- Platform Master Admin accounts and override audit trail
-- Strictly locked down via RLS (only service_role / Edge Functions may access).

CREATE TABLE IF NOT EXISTS public.platform_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT 'Founder',
  password_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.platform_admins FROM PUBLIC;
REVOKE ALL ON TABLE public.platform_admins FROM anon;
REVOKE ALL ON TABLE public.platform_admins FROM authenticated;

CREATE TABLE IF NOT EXISTS public.platform_admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES public.platform_admins(id) ON DELETE SET NULL,
  admin_email text NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_admin_audit_logs_created_at
  ON public.platform_admin_audit_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_admin_audit_logs_company_id
  ON public.platform_admin_audit_logs(company_id);

ALTER TABLE public.platform_admin_audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.platform_admin_audit_logs FROM PUBLIC;
REVOKE ALL ON TABLE public.platform_admin_audit_logs FROM anon;
REVOKE ALL ON TABLE public.platform_admin_audit_logs FROM authenticated;

