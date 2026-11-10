-- PDF → HTML/CSS template engine: the converted template (html + extracted assets), its metadata, and which renderer report cards use.
ALTER TABLE "report_card_templates" ADD COLUMN IF NOT EXISTS "html_template" JSONB;
ALTER TABLE "report_card_templates" ADD COLUMN IF NOT EXISTS "html_meta" JSONB;
ALTER TABLE "report_card_templates" ADD COLUMN IF NOT EXISTS "render_mode" TEXT NOT NULL DEFAULT 'overlay';
