-- Marks move from a 0–100 scale to a 0–20 scale.
--
-- A school whose stored marks are still on /100 (any mark above 20 proves it) has every score
-- divided by 5 (2 decimals). A school whose marks are already <= 20 was entered on the new scale
-- and is left untouched, so this can never divide twice or corrupt data entered after the switch.
-- Letter grades already stored stay valid because the grade bands were scaled by the same factor
-- (A+ 90 -> 18, A 80 -> 16, B 70 -> 14, C 60 -> 12, D 50 -> 10). Prisma runs it once per school;
-- new schools have empty tables, so nothing happens there.
DO $$
DECLARE legacy boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM "marks" WHERE "ca_score" > 20 OR "exam_score" > 20 OR "total_score" > 20
  ) INTO legacy;

  IF legacy THEN
    -- Sequence marks and per-subject total
    UPDATE "marks" SET
      "ca_score"    = ROUND(("ca_score"    / 5.0)::numeric, 2)::double precision,
      "exam_score"  = ROUND(("exam_score"  / 5.0)::numeric, 2)::double precision,
      "total_score" = ROUND(("total_score" / 5.0)::numeric, 2)::double precision;

    -- Report card lines (snapshots of the marks above)
    UPDATE "report_card_entries" SET
      "ca_score"    = ROUND(("ca_score"    / 5.0)::numeric, 2)::double precision,
      "exam_score"  = ROUND(("exam_score"  / 5.0)::numeric, 2)::double precision,
      "total_score" = ROUND(("total_score" / 5.0)::numeric, 2)::double precision;

    -- Report card headers: totals, averages and the "possible" total (subjects x 100 -> x 20)
    UPDATE "report_cards" SET
      "total_marks_obtained" = ROUND(("total_marks_obtained" / 5.0)::numeric, 2)::double precision,
      "total_marks_possible" = ROUND(("total_marks_possible" / 5.0)::numeric, 2)::double precision,
      "percentage"           = ROUND(("percentage"           / 5.0)::numeric, 2)::double precision,
      "sequence1_average"    = ROUND(("sequence1_average"    / 5.0)::numeric, 2)::double precision,
      "sequence2_average"    = ROUND(("sequence2_average"    / 5.0)::numeric, 2)::double precision;

    -- End-of-year stored averages
    UPDATE "year_end_decisions" SET "calculated_average" = ROUND(("calculated_average" / 5.0)::numeric, 2)::double precision
      WHERE "calculated_average" IS NOT NULL;
  END IF;
END $$;

-- End-of-year pass mark: new default is 10. A stored value above 20 can only be on the old scale.
ALTER TABLE "year_end_config" ALTER COLUMN "pass_average" SET DEFAULT 10;
UPDATE "year_end_config" SET "pass_average" = ROUND(("pass_average" / 5.0)::numeric, 2)::double precision
  WHERE "pass_average" > 20;
