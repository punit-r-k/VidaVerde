# Supabase Migrations

Run these files in filename order when updating an existing Supabase database.

`supabase/schema.sql` remains the full rebuild reference for a fresh database. The migration
files are the safer way to apply incremental production changes because each file only contains
the changes needed for that step.

