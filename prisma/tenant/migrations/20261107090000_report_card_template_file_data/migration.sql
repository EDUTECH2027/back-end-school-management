-- Keep the uploaded template PDF in the database: files on the server disk are lost on redeploy.
ALTER TABLE "report_card_templates" ADD COLUMN IF NOT EXISTS "file_data" BYTEA;
