ALTER TABLE organizations ADD COLUMN IF NOT EXISTS free_forever BOOLEAN DEFAULT false;

-- Set FCG org as free forever
UPDATE organizations SET free_forever = true WHERE id = '0097de02-6fd7-4852-a0dd-61a65edca083';
