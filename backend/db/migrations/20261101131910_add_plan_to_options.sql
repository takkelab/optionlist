-- migrate:up
ALTER TABLE options
  ADD COLUMN planned_on DATE NULL AFTER sort_order,
  ADD COLUMN memo TEXT NULL AFTER planned_on;

-- migrate:down
ALTER TABLE options
  DROP COLUMN memo,
  DROP COLUMN planned_on;
