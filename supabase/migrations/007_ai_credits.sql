-- AI credits system
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_credits_monthly INT DEFAULT 100;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_credits_used INT DEFAULT 0;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_credits_purchased INT DEFAULT 0;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_credits_reset_at TIMESTAMPTZ DEFAULT NOW();

-- Usage log
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  plan_id UUID,
  project_id UUID,
  tokens_used INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_log_select" ON ai_usage_log;
CREATE POLICY "ai_log_select" ON ai_usage_log FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));
DROP POLICY IF EXISTS "ai_log_insert" ON ai_usage_log;
CREATE POLICY "ai_log_insert" ON ai_usage_log FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT public.user_org_ids()));

-- Function to get credits and atomically increment usage
CREATE OR REPLACE FUNCTION public.use_ai_credit(p_plan_id UUID, p_project_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_org_id UUID;
  v_monthly INT;
  v_used INT;
  v_purchased INT;
  v_reset_at TIMESTAMPTZ;
  v_available INT;
BEGIN
  -- Get user's org
  SELECT org_id INTO v_org_id FROM public.memberships WHERE user_id = (SELECT auth.uid()) LIMIT 1;
  IF v_org_id IS NULL THEN RETURN json_build_object('error', 'No organization found'); END IF;

  -- Get current credits
  SELECT ai_credits_monthly, ai_credits_used, ai_credits_purchased, ai_credits_reset_at
  INTO v_monthly, v_used, v_purchased, v_reset_at
  FROM public.organizations WHERE id = v_org_id;

  -- Auto-reset if > 30 days since last reset
  IF v_reset_at < NOW() - INTERVAL '30 days' THEN
    UPDATE public.organizations SET ai_credits_used = 0, ai_credits_reset_at = NOW() WHERE id = v_org_id;
    v_used := 0;
  END IF;

  v_available := (v_monthly - v_used) + v_purchased;

  IF v_available <= 0 THEN
    RETURN json_build_object('error', 'No credits remaining', 'available', 0, 'monthly', v_monthly, 'used', v_used, 'purchased', v_purchased);
  END IF;

  -- Decrement: use from monthly first, then purchased
  IF v_used < v_monthly THEN
    UPDATE public.organizations SET ai_credits_used = ai_credits_used + 1 WHERE id = v_org_id;
  ELSE
    UPDATE public.organizations SET ai_credits_purchased = GREATEST(0, ai_credits_purchased - 1) WHERE id = v_org_id;
  END IF;

  -- Log usage
  INSERT INTO public.ai_usage_log (org_id, user_id, plan_id, project_id)
  VALUES (v_org_id, (SELECT auth.uid()), p_plan_id, p_project_id);

  RETURN json_build_object('ok', true, 'available', v_available - 1, 'monthly', v_monthly, 'used', v_used + 1, 'purchased', v_purchased);
END;
$$;

GRANT EXECUTE ON FUNCTION public.use_ai_credit(UUID, UUID) TO authenticated;

-- Function to get credit balance (no mutation)
CREATE OR REPLACE FUNCTION public.get_ai_credits()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_org_id UUID;
  v_monthly INT;
  v_used INT;
  v_purchased INT;
  v_reset_at TIMESTAMPTZ;
BEGIN
  SELECT org_id INTO v_org_id FROM public.memberships WHERE user_id = (SELECT auth.uid()) LIMIT 1;
  IF v_org_id IS NULL THEN RETURN json_build_object('available', 0); END IF;

  SELECT ai_credits_monthly, ai_credits_used, ai_credits_purchased, ai_credits_reset_at
  INTO v_monthly, v_used, v_purchased, v_reset_at
  FROM public.organizations WHERE id = v_org_id;

  -- Auto-reset
  IF v_reset_at < NOW() - INTERVAL '30 days' THEN
    UPDATE public.organizations SET ai_credits_used = 0, ai_credits_reset_at = NOW() WHERE id = v_org_id;
    v_used := 0;
  END IF;

  RETURN json_build_object(
    'available', (v_monthly - v_used) + v_purchased,
    'monthly', v_monthly,
    'used', v_used,
    'purchased', v_purchased,
    'reset_at', v_reset_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ai_credits() TO authenticated;

NOTIFY pgrst, 'reload schema';
