


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."append_received_chunk"("p_file_uid" "uuid", "p_chunk_index" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE uploads
  SET received_chunks = array_append(received_chunks, p_chunk_index)
  WHERE file_uid = p_file_uid
    AND NOT (p_chunk_index = ANY(received_chunks));
END;
$$;


ALTER FUNCTION "public"."append_received_chunk"("p_file_uid" "uuid", "p_chunk_index" integer) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."storage_transacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transaction_uid" "text" NOT NULL,
    "vault_uid" "text" NOT NULL,
    "storage_bytes" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "previous_transact" "uuid"
);


ALTER TABLE "public"."storage_transacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."uploads" (
    "upload_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vault_uid" "text" NOT NULL,
    "file_uid" "uuid" NOT NULL,
    "file_name_encrypted" "bytea",
    "total_chunks" integer NOT NULL,
    "received_chunks" integer[] DEFAULT '{}'::integer[],
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."uploads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vaults" (
    "uid" "text" NOT NULL,
    "schema_cipher" "bytea" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "burn_at" timestamp with time zone,
    "storage_used" bigint DEFAULT 0,
    "storage_limit" bigint DEFAULT '5368709120'::bigint
);


ALTER TABLE "public"."vaults" OWNER TO "postgres";


ALTER TABLE ONLY "public"."storage_transacts"
    ADD CONSTRAINT "storage_transacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."uploads"
    ADD CONSTRAINT "uploads_pkey" PRIMARY KEY ("upload_id");



ALTER TABLE ONLY "public"."vaults"
    ADD CONSTRAINT "vaults_pkey" PRIMARY KEY ("uid");



CREATE INDEX "idx_storage_previous" ON "public"."storage_transacts" USING "btree" ("previous_transact");



CREATE INDEX "idx_storage_vault" ON "public"."storage_transacts" USING "btree" ("vault_uid");



CREATE INDEX "idx_uploads_file" ON "public"."uploads" USING "btree" ("file_uid");



CREATE INDEX "idx_uploads_vault" ON "public"."uploads" USING "btree" ("vault_uid");



CREATE INDEX "idx_vaults_burn" ON "public"."vaults" USING "btree" ("burn_at") WHERE ("burn_at" IS NOT NULL);



ALTER TABLE ONLY "public"."storage_transacts"
    ADD CONSTRAINT "storage_transacts_previous_transact_fkey" FOREIGN KEY ("previous_transact") REFERENCES "public"."storage_transacts"("id");



ALTER TABLE ONLY "public"."storage_transacts"
    ADD CONSTRAINT "storage_transacts_vault_uid_fkey" FOREIGN KEY ("vault_uid") REFERENCES "public"."vaults"("uid") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."uploads"
    ADD CONSTRAINT "uploads_vault_uid_fkey" FOREIGN KEY ("vault_uid") REFERENCES "public"."vaults"("uid") ON DELETE CASCADE;



ALTER TABLE "public"."storage_transacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transacts_delete_by_header" ON "public"."storage_transacts" FOR DELETE USING (("vault_uid" = (("current_setting"('request.headers'::"text", true))::json ->> 'x-vault-uid'::"text")));



CREATE POLICY "transacts_insert_public" ON "public"."storage_transacts" FOR INSERT WITH CHECK (true);



CREATE POLICY "transacts_select_by_header" ON "public"."storage_transacts" FOR SELECT USING (("vault_uid" = (("current_setting"('request.headers'::"text", true))::json ->> 'x-vault-uid'::"text")));



CREATE POLICY "transacts_update_by_header" ON "public"."storage_transacts" FOR UPDATE USING (("vault_uid" = (("current_setting"('request.headers'::"text", true))::json ->> 'x-vault-uid'::"text")));



ALTER TABLE "public"."uploads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "uploads_all_by_header" ON "public"."uploads" USING (("vault_uid" = (("current_setting"('request.headers'::"text", true))::json ->> 'x-vault-uid'::"text")));



ALTER TABLE "public"."vaults" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vaults_delete_by_header" ON "public"."vaults" FOR DELETE USING (("uid" = (("current_setting"('request.headers'::"text", true))::json ->> 'x-vault-uid'::"text")));



CREATE POLICY "vaults_insert_public" ON "public"."vaults" FOR INSERT WITH CHECK (true);



CREATE POLICY "vaults_select_by_header" ON "public"."vaults" FOR SELECT USING (("uid" = (("current_setting"('request.headers'::"text", true))::json ->> 'x-vault-uid'::"text")));



CREATE POLICY "vaults_update_by_header" ON "public"."vaults" FOR UPDATE USING (("uid" = (("current_setting"('request.headers'::"text", true))::json ->> 'x-vault-uid'::"text")));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

















































































































































































GRANT ALL ON FUNCTION "public"."append_received_chunk"("p_file_uid" "uuid", "p_chunk_index" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."append_received_chunk"("p_file_uid" "uuid", "p_chunk_index" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."append_received_chunk"("p_file_uid" "uuid", "p_chunk_index" integer) TO "service_role";
























GRANT ALL ON TABLE "public"."storage_transacts" TO "anon";
GRANT ALL ON TABLE "public"."storage_transacts" TO "authenticated";
GRANT ALL ON TABLE "public"."storage_transacts" TO "service_role";



GRANT ALL ON TABLE "public"."uploads" TO "anon";
GRANT ALL ON TABLE "public"."uploads" TO "authenticated";
GRANT ALL ON TABLE "public"."uploads" TO "service_role";



GRANT ALL ON TABLE "public"."vaults" TO "anon";
GRANT ALL ON TABLE "public"."vaults" TO "authenticated";
GRANT ALL ON TABLE "public"."vaults" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































