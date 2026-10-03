-- Metadata-only staging baseline; no production rows, sequence counters or outbound functions.
SET search_path = public, extensions;
SET check_function_bodies = off;
CREATE SEQUENCE public."ticket_seq" AS bigint START WITH 1;
CREATE SEQUENCE public."cotizacion_seq" AS bigint START WITH 1;
CREATE SEQUENCE public."invoice_seq" AS bigint START WITH 1;
CREATE TABLE public."app_bug_reports" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "descripcion" text NOT NULL,
 "severidad" text DEFAULT 'molestia'::text NOT NULL,
 "screenshot_storage_path" text,
 "context" jsonb DEFAULT '{}'::jsonb NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "created_by" uuid DEFAULT auth.uid()
);
ALTER TABLE public."app_bug_reports" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."app_settings" (
 "key" text NOT NULL,
 "values" text[] DEFAULT '{}'::text[] NOT NULL
);
ALTER TABLE public."app_settings" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."bitacora" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "ticket_id" uuid NOT NULL,
 "tipo" text NOT NULL,
 "autor" text,
 "ts" timestamp with time zone DEFAULT now() NOT NULL,
 "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
 "deleted_at" timestamp with time zone,
 "deleted_by" text
);
ALTER TABLE public."bitacora" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."chat_conversations" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "member_a" uuid,
 "member_b" uuid,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "kind" text DEFAULT 'direct'::text NOT NULL,
 "ticket_id" uuid
);
ALTER TABLE public."chat_conversations" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."chat_later" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "user_id" uuid NOT NULL,
 "post_id" uuid NOT NULL,
 "remind_at" timestamp with time zone,
 "completed_at" timestamp with time zone,
 "archived_at" timestamp with time zone,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public."chat_later" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."chat_read_state" (
 "user_id" uuid NOT NULL,
 "conversation_id" uuid,
 "scope_key" text GENERATED ALWAYS AS (COALESCE((conversation_id)::text, 'team'::text)) STORED NOT NULL,
 "last_seen_at" timestamp with time zone,
 "last_mention_seen_at" timestamp with time zone,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public."chat_read_state" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."chat_ticket_links" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "ticket_id" uuid NOT NULL,
 "post_id" uuid NOT NULL,
 "link_kind" text NOT NULL,
 "linked_by" uuid NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public."chat_ticket_links" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."chat_user_state" (
 "user_id" uuid NOT NULL,
 "last_seen_at" timestamp with time zone,
 "last_mention_seen_at" timestamp with time zone,
 "notif_mensajes" boolean DEFAULT true NOT NULL,
 "notif_menciones" boolean DEFAULT true NOT NULL,
 "notif_push" boolean DEFAULT false NOT NULL,
 "sonidos" boolean DEFAULT true NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
 "notif_after_hours" boolean DEFAULT false NOT NULL
);
ALTER TABLE public."chat_user_state" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."client_notes" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "client_id" uuid NOT NULL,
 "body" text NOT NULL,
 "author_user_id" uuid DEFAULT auth.uid() NOT NULL,
 "author_name" text NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public."client_notes" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."client_tasks" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "client_id" uuid NOT NULL,
 "description" text NOT NULL,
 "note" text DEFAULT ''::text NOT NULL,
 "responsable" text NOT NULL,
 "area" text NOT NULL,
 "estado" text DEFAULT 'pendiente'::text NOT NULL,
 "created_by" uuid DEFAULT auth.uid() NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "completed_at" timestamp with time zone
);
ALTER TABLE public."client_tasks" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."clientes" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "nombre" text NOT NULL,
 "empresa" text,
 "telefono" text,
 "email" text,
 "notas_comerciales" text,
 "preautorizado" boolean DEFAULT false NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "tax_exempt" boolean DEFAULT false NOT NULL,
 "tax_exempt_reason" text,
 "tax_exempt_ref" text,
 "logo_storage_path" text,
 "accent_theme" text,
 "visual_style" text DEFAULT 'normal'::text NOT NULL,
 "frequent_client" boolean DEFAULT false NOT NULL,
 "high_ticket" boolean DEFAULT false NOT NULL,
 "archived_at" timestamp with time zone,
 "merged_into" uuid
);
ALTER TABLE public."clientes" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."documentos" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "ticket_id" uuid NOT NULL,
 "tipo" text NOT NULL,
 "numero" text,
 "cliente_nombre" text DEFAULT ''::text NOT NULL,
 "notas" text,
 "items" jsonb DEFAULT '[]'::jsonb NOT NULL,
 "total" numeric DEFAULT 0 NOT NULL,
 "autor" text,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "cobrado_al_crear" numeric DEFAULT 0 NOT NULL,
 "bill_to" jsonb DEFAULT '{}'::jsonb NOT NULL,
 "pricing_snapshot" jsonb
);
ALTER TABLE public."documentos" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."feed_reactions" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "target_type" text NOT NULL,
 "target_id" text NOT NULL,
 "user_id" uuid NOT NULL,
 "user_name_snapshot" text DEFAULT ''::text NOT NULL,
 "reaction_type" text NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public."feed_reactions" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."pagos" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "ticket_id" uuid NOT NULL,
 "monto" numeric NOT NULL,
 "fecha" date DEFAULT CURRENT_DATE NOT NULL,
 "metodo" text,
 "concepto" text,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "client_op_id" uuid
);
ALTER TABLE public."pagos" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."productos" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "ticket_id" uuid NOT NULL,
 "descripcion" text NOT NULL,
 "cantidad" numeric DEFAULT 1 NOT NULL,
 "precio" numeric,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public."productos" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."profiles" (
 "id" uuid NOT NULL,
 "display_name" text DEFAULT ''::text NOT NULL,
 "role" text,
 "active" boolean DEFAULT true NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "can_manage_privacy" boolean DEFAULT false NOT NULL,
 "accent_color" text,
 "avatar_storage_path" text,
 "default_task_area" text
);
ALTER TABLE public."profiles" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."push_subscriptions" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "user_id" uuid NOT NULL,
 "endpoint" text NOT NULL,
 "p256dh" text NOT NULL,
 "auth" text NOT NULL,
 "user_agent" text,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "last_ok_at" timestamp with time zone,
 "failures" smallint DEFAULT 0 NOT NULL
);
ALTER TABLE public."push_subscriptions" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."tareas" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "ticket_id" uuid NOT NULL,
 "descripcion" text NOT NULL,
 "tipo" text DEFAULT 'normal'::text NOT NULL,
 "responsable" text,
 "fecha_atencion" date,
 "estado" text DEFAULT 'pendiente'::text NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "progreso" smallint DEFAULT 0 NOT NULL,
 "tipo_operacion" text,
 "terminado_at" timestamp with time zone,
 "area" text,
 "work_order_id" uuid,
 "action_code" text,
 "action_path" text
);
ALTER TABLE public."tareas" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."team_posts" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "author_user_id" uuid,
 "author_name_snapshot" text DEFAULT ''::text NOT NULL,
 "text" text DEFAULT ''::text NOT NULL,
 "image_storage_path" text,
 "ticket_id" uuid,
 "no_ticket_required" boolean DEFAULT false NOT NULL,
 "pin_level" text DEFAULT 'none'::text NOT NULL,
 "pinned_by" text,
 "pinned_at" timestamp with time zone,
 "expires_at" timestamp with time zone,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "deleted_at" timestamp with time zone,
 "deleted_by" text,
 "mentions" jsonb,
 "mentions_all" boolean DEFAULT false NOT NULL,
 "push_sent_at" timestamp with time zone,
 "conversation_id" uuid,
 "reply_to_id" uuid,
 "thread_root_id" uuid,
 "references_data" jsonb DEFAULT '[]'::jsonb NOT NULL,
 "audio_storage_path" text,
 "audio_mime" text,
 "audio_seconds" integer,
 "transcript" text,
 "transcript_status" text,
 "file_storage_path" text,
 "file_name" text,
 "file_mime" text,
 "file_size" bigint
);
ALTER TABLE public."team_posts" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."ticket_access" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "ticket_id" uuid NOT NULL,
 "profile_id" uuid NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public."ticket_access" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."ticket_markers" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "ticket_id" uuid NOT NULL,
 "type" text NOT NULL,
 "text" text,
 "source_bitacora_id" uuid,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "created_by" text,
 "resolved_at" timestamp with time zone,
 "resolved_by" text
);
ALTER TABLE public."ticket_markers" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."tickets" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "seq" bigint DEFAULT nextval('ticket_seq'::regclass) NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
 "pinned" boolean DEFAULT false NOT NULL,
 "cliente" text DEFAULT ''::text NOT NULL,
 "que_sigue" text DEFAULT ''::text NOT NULL,
 "responsable" text DEFAULT ''::text NOT NULL,
 "fecha_atencion" date,
 "fecha_compromiso" date,
 "cliente_id" uuid,
 "entregado_at" timestamp with time zone,
 "entregado_por" text,
 "cierre_tipo" text,
 "cerrado_at" timestamp with time zone,
 "razon_cierre" text,
 "cerrado_por" text,
 "visibility" text DEFAULT 'team'::text NOT NULL,
 "delivery_zone" text,
 "fecha_evento" date,
 "fechas_auxiliares" jsonb DEFAULT '[]'::jsonb NOT NULL
);
ALTER TABLE public."tickets" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."work_orders" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "ticket_id" uuid NOT NULL,
 "product_id" uuid,
 "title" text NOT NULL,
 "instructions" text DEFAULT ''::text NOT NULL,
 "quantity_override" numeric,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public."work_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."app_bug_reports" ADD CONSTRAINT "app_bug_reports_pkey" PRIMARY KEY (id);
ALTER TABLE public."app_settings" ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY (key);
ALTER TABLE public."bitacora" ADD CONSTRAINT "bitacora_pkey" PRIMARY KEY (id);
ALTER TABLE public."bitacora" ADD CONSTRAINT "bitacora_tipo_check" CHECK ((tipo = ANY (ARRAY['nota'::text, 'sistema'::text, 'producto'::text, 'tarea'::text, 'tarea_produccion'::text, 'pago'::text, 'archivo'::text, 'documento'::text])));
ALTER TABLE public."chat_conversations" ADD CONSTRAINT "chat_conversations_member_a_member_b_key" UNIQUE (member_a, member_b);
ALTER TABLE public."chat_conversations" ADD CONSTRAINT "chat_conversations_pkey" PRIMARY KEY (id);
ALTER TABLE public."chat_conversations" ADD CONSTRAINT "conversation_scope_check" CHECK ((((kind = 'direct'::text) AND (ticket_id IS NULL) AND (member_a IS NOT NULL) AND (member_b IS NOT NULL) AND (member_a < member_b)) OR ((kind = 'ticket'::text) AND (ticket_id IS NOT NULL) AND (member_a IS NULL) AND (member_b IS NULL))));
ALTER TABLE public."chat_conversations" ADD CONSTRAINT "distinct_members" CHECK ((member_a < member_b));
ALTER TABLE public."chat_later" ADD CONSTRAINT "chat_later_pkey" PRIMARY KEY (id);
ALTER TABLE public."chat_later" ADD CONSTRAINT "chat_later_user_id_post_id_key" UNIQUE (user_id, post_id);
ALTER TABLE public."chat_read_state" ADD CONSTRAINT "chat_read_state_pkey" PRIMARY KEY (user_id, scope_key);
ALTER TABLE public."chat_ticket_links" ADD CONSTRAINT "chat_ticket_links_link_kind_check" CHECK ((link_kind = ANY (ARRAY['message'::text, 'thread'::text])));
ALTER TABLE public."chat_ticket_links" ADD CONSTRAINT "chat_ticket_links_pkey" PRIMARY KEY (id);
ALTER TABLE public."chat_ticket_links" ADD CONSTRAINT "chat_ticket_links_ticket_id_post_id_link_kind_key" UNIQUE (ticket_id, post_id, link_kind);
ALTER TABLE public."chat_user_state" ADD CONSTRAINT "chat_user_state_pkey" PRIMARY KEY (user_id);
ALTER TABLE public."client_notes" ADD CONSTRAINT "client_notes_body_check" CHECK (((length(TRIM(BOTH FROM body)) >= 1) AND (length(TRIM(BOTH FROM body)) <= 2000)));
ALTER TABLE public."client_notes" ADD CONSTRAINT "client_notes_pkey" PRIMARY KEY (id);
ALTER TABLE public."client_tasks" ADD CONSTRAINT "client_tasks_area_check" CHECK ((area = ANY (ARRAY['planeacion'::text, 'produccion'::text])));
ALTER TABLE public."client_tasks" ADD CONSTRAINT "client_tasks_description_check" CHECK (((length(TRIM(BOTH FROM description)) >= 1) AND (length(TRIM(BOTH FROM description)) <= 120)));
ALTER TABLE public."client_tasks" ADD CONSTRAINT "client_tasks_estado_check" CHECK ((estado = ANY (ARRAY['pendiente'::text, 'terminado'::text])));
ALTER TABLE public."client_tasks" ADD CONSTRAINT "client_tasks_note_check" CHECK ((length(note) <= 240));
ALTER TABLE public."client_tasks" ADD CONSTRAINT "client_tasks_pkey" PRIMARY KEY (id);
ALTER TABLE public."clientes" ADD CONSTRAINT "clientes_accent_theme_check" CHECK (((accent_theme IS NULL) OR (accent_theme = ANY (ARRAY['rose'::text, 'magenta'::text, 'violet'::text, 'blue'::text, 'cyan'::text, 'teal'::text, 'green'::text, 'gold'::text, 'orange'::text, 'red'::text, 'silver'::text, 'neutral'::text]))));
ALTER TABLE public."clientes" ADD CONSTRAINT "clientes_pkey" PRIMARY KEY (id);
ALTER TABLE public."clientes" ADD CONSTRAINT "clientes_visual_style_check" CHECK ((visual_style = ANY (ARRAY['normal'::text, 'accent'::text, 'glow'::text, 'metallic'::text, 'spotlight'::text])));
ALTER TABLE public."documentos" ADD CONSTRAINT "documentos_pkey" PRIMARY KEY (id);
ALTER TABLE public."documentos" ADD CONSTRAINT "documentos_tipo_check" CHECK ((tipo = ANY (ARRAY['cotizacion'::text, 'invoice'::text])));
ALTER TABLE public."feed_reactions" ADD CONSTRAINT "feed_reactions_pkey" PRIMARY KEY (id);
ALTER TABLE public."feed_reactions" ADD CONSTRAINT "feed_reactions_reaction_type_check" CHECK ((reaction_type = ANY (ARRAY['celebrate'::text, 'terrible'::text, 'surprised'::text, 'oh_no'::text, 'im_in'::text, 'confused'::text, 'ack'::text, 'laugh'::text, 'love'::text])));
ALTER TABLE public."feed_reactions" ADD CONSTRAINT "feed_reactions_target_type_check" CHECK ((target_type = ANY (ARRAY['post'::text, 'event'::text])));
ALTER TABLE public."feed_reactions" ADD CONSTRAINT "feed_reactions_target_type_target_id_user_id_key" UNIQUE (target_type, target_id, user_id);
ALTER TABLE public."pagos" ADD CONSTRAINT "pagos_pkey" PRIMARY KEY (id);
ALTER TABLE public."productos" ADD CONSTRAINT "productos_pkey" PRIMARY KEY (id);
ALTER TABLE public."profiles" ADD CONSTRAINT "profile_avatar_own_folder" CHECK (((avatar_storage_path IS NULL) OR (split_part(avatar_storage_path, '/'::text, 1) = (id)::text)));
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_accent_color_check" CHECK (((accent_color IS NULL) OR (accent_color = ANY (ARRAY['blue'::text, 'cyan'::text, 'teal'::text, 'green'::text, 'lime'::text, 'amber'::text, 'orange'::text, 'coral'::text, 'red'::text, 'violet'::text, 'purple'::text, 'pink'::text, 'silver'::text]))));
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_default_task_area_check" CHECK (((default_task_area IS NULL) OR (default_task_area = ANY (ARRAY['planeacion'::text, 'produccion'::text]))));
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_pkey" PRIMARY KEY (id);
ALTER TABLE public."push_subscriptions" ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY (id);
ALTER TABLE public."tareas" ADD CONSTRAINT "tareas_area_chk" CHECK (((area IS NULL) OR (area = ANY (ARRAY['planeacion'::text, 'produccion'::text]))));
ALTER TABLE public."tareas" ADD CONSTRAINT "tareas_estado_check" CHECK ((estado = ANY (ARRAY['pendiente'::text, 'en_proceso'::text, 'esperando'::text, 'terminado'::text])));
ALTER TABLE public."tareas" ADD CONSTRAINT "tareas_pkey" PRIMARY KEY (id);
ALTER TABLE public."tareas" ADD CONSTRAINT "tareas_progreso_check" CHECK (((progreso >= 0) AND (progreso <= 100)));
ALTER TABLE public."tareas" ADD CONSTRAINT "tareas_tipo_check" CHECK ((tipo = ANY (ARRAY['normal'::text, 'produccion'::text])));
ALTER TABLE public."team_posts" ADD CONSTRAINT "team_posts_file_size_check" CHECK (((file_size IS NULL) OR (file_size >= 0)));
ALTER TABLE public."team_posts" ADD CONSTRAINT "team_posts_pin_level_check" CHECK ((pin_level = ANY (ARRAY['none'::text, 'pin'::text, 'megapin'::text])));
ALTER TABLE public."team_posts" ADD CONSTRAINT "team_posts_pkey" PRIMARY KEY (id);
ALTER TABLE public."team_posts" ADD CONSTRAINT "team_posts_transcript_status_check" CHECK ((transcript_status = ANY (ARRAY['transcribing'::text, 'ready'::text, 'failed'::text])));
ALTER TABLE public."ticket_access" ADD CONSTRAINT "ticket_access_pkey" PRIMARY KEY (id);
ALTER TABLE public."ticket_access" ADD CONSTRAINT "ticket_access_ticket_id_profile_id_key" UNIQUE (ticket_id, profile_id);
ALTER TABLE public."ticket_markers" ADD CONSTRAINT "ticket_markers_pkey" PRIMARY KEY (id);
ALTER TABLE public."ticket_markers" ADD CONSTRAINT "ticket_markers_type_check" CHECK ((type = ANY (ARRAY['urgente'::text, 'cliente_molesto'::text, 'pendiente_cobro'::text, 'no_producir'::text, 'falta_informacion'::text, 'ordenar'::text, 'mexico'::text, 'rgv'::text, 'diseno'::text, 'esperando_cliente'::text, 'esperando_pago'::text, 'material'::text, 'imprimir'::text, 'acabado'::text, 'costura'::text, 'recoger'::text, 'entregar'::text, 'envio'::text, 'bloqueado'::text, 'esperando_demo'::text])));
ALTER TABLE public."tickets" ADD CONSTRAINT "tickets_cierre_tipo_check" CHECK ((cierre_tipo = ANY (ARRAY['pagado'::text, 'cancelado'::text])));
ALTER TABLE public."tickets" ADD CONSTRAINT "tickets_delivery_zone_check" CHECK (((delivery_zone IS NULL) OR (delivery_zone = ANY (ARRAY['matamoros'::text, 'brownsville'::text, 'harlingen_area'::text, 'mcallen_area'::text, 'south_padre_island'::text, 'otra'::text, 'los_fresnos'::text, 'olmito'::text, 'san_benito'::text, 'harlingen'::text, 'la_feria'::text, 'weslaco'::text, 'mercedes'::text, 'port_isabel'::text, 'starbase'::text, 'donna'::text, 'san_juan'::text, 'pharr'::text, 'mcallen'::text, 'edinburg'::text, 'mission'::text, 'palmview'::text, 'hidalgo'::text, 'edcouch'::text, 'alamo'::text, 'elsa'::text, 'rio_hondo'::text, 'reynosa'::text, 'rio_grande_city'::text]))));
ALTER TABLE public."tickets" ADD CONSTRAINT "tickets_fecha_evento_sane" CHECK (((fecha_evento IS NULL) OR ((fecha_evento >= '2000-01-01'::date) AND (fecha_evento <= '2100-12-31'::date))));
ALTER TABLE public."tickets" ADD CONSTRAINT "tickets_fechas_auxiliares_array" CHECK (((jsonb_typeof(fechas_auxiliares) = 'array'::text) AND (jsonb_array_length(fechas_auxiliares) <= 50)));
ALTER TABLE public."tickets" ADD CONSTRAINT "tickets_named_client_has_identity" CHECK (((NULLIF(btrim(cliente), ''::text) IS NULL) OR (cliente_id IS NOT NULL)));
ALTER TABLE public."tickets" ADD CONSTRAINT "tickets_pkey" PRIMARY KEY (id);
ALTER TABLE public."tickets" ADD CONSTRAINT "tickets_seq_key" UNIQUE (seq);
ALTER TABLE public."tickets" ADD CONSTRAINT "tickets_visibility_check" CHECK ((visibility = ANY (ARRAY['team'::text, 'private'::text])));
ALTER TABLE public."work_orders" ADD CONSTRAINT "work_orders_pkey" PRIMARY KEY (id);
ALTER TABLE public."work_orders" ADD CONSTRAINT "work_orders_quantity_override_check" CHECK (((quantity_override IS NULL) OR (quantity_override > (0)::numeric)));
ALTER TABLE public."work_orders" ADD CONSTRAINT "work_orders_ticket_id_id_key" UNIQUE (ticket_id, id);
ALTER TABLE public."work_orders" ADD CONSTRAINT "work_orders_title_check" CHECK (((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 160)));
CREATE INDEX bitacora_ticket_ts_idx ON public.bitacora USING btree (ticket_id, ts);
CREATE UNIQUE INDEX chat_conversations_ticket_unique ON public.chat_conversations USING btree (ticket_id) WHERE (kind = 'ticket'::text);
CREATE INDEX chat_read_state_conversation_idx ON public.chat_read_state USING btree (conversation_id);
CREATE INDEX client_notes_client_date ON public.client_notes USING btree (client_id, created_at DESC);
CREATE INDEX client_tasks_client_state ON public.client_tasks USING btree (client_id, estado);
CREATE INDEX clientes_empresa_idx ON public.clientes USING btree (lower(COALESCE(empresa, ''::text)));

CREATE INDEX clientes_nombre_idx ON public.clientes USING btree (lower(nombre));
CREATE INDEX documentos_ticket_idx ON public.documentos USING btree (ticket_id);
CREATE INDEX feed_reactions_target_idx ON public.feed_reactions USING btree (target_type, target_id);
CREATE UNIQUE INDEX pagos_client_op_id_key ON public.pagos USING btree (client_op_id) WHERE (client_op_id IS NOT NULL);
CREATE INDEX pagos_ticket_idx ON public.pagos USING btree (ticket_id);
CREATE INDEX productos_ticket_idx ON public.productos USING btree (ticket_id);
CREATE UNIQUE INDEX push_subscriptions_endpoint_key ON public.push_subscriptions USING btree (endpoint);
CREATE INDEX push_subscriptions_user_idx ON public.push_subscriptions USING btree (user_id);
CREATE INDEX tareas_area_estado_idx ON public.tareas USING btree (area, estado) WHERE (estado <> 'terminado'::text);
CREATE INDEX tareas_ticket_id_idx ON public.tareas USING btree (ticket_id);
CREATE INDEX tareas_ticket_idx ON public.tareas USING btree (ticket_id);
CREATE INDEX tareas_work_order_id_idx ON public.tareas USING btree (work_order_id);
CREATE INDEX team_posts_conversation_time ON public.team_posts USING btree (conversation_id, created_at);
CREATE INDEX team_posts_created_at_idx ON public.team_posts USING btree (created_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX team_posts_created_idx ON public.team_posts USING btree (created_at DESC);
CREATE INDEX team_posts_mentions_idx ON public.team_posts USING gin (mentions);
CREATE INDEX team_posts_thread_time ON public.team_posts USING btree (thread_root_id, created_at);
CREATE INDEX team_posts_ticket_id_idx ON public.team_posts USING btree (ticket_id);
CREATE INDEX team_posts_unlinked_idx ON public.team_posts USING btree (created_at DESC) WHERE ((ticket_id IS NULL) AND (no_ticket_required = false) AND (deleted_at IS NULL));
CREATE INDEX ticket_access_profile_id_idx ON public.ticket_access USING btree (profile_id);
CREATE INDEX ticket_access_ticket_id_idx ON public.ticket_access USING btree (ticket_id);
CREATE INDEX idx_ticket_markers_active ON public.ticket_markers USING btree (ticket_id) WHERE (resolved_at IS NULL);
CREATE INDEX idx_ticket_markers_ticket_id ON public.ticket_markers USING btree (ticket_id);
CREATE INDEX idx_tickets_fecha_atencion ON public.tickets USING btree (fecha_atencion) WHERE (fecha_atencion IS NOT NULL);
CREATE INDEX idx_tickets_fecha_compromiso ON public.tickets USING btree (fecha_compromiso) WHERE (fecha_compromiso IS NOT NULL);
CREATE INDEX tickets_cliente_id_idx ON public.tickets USING btree (cliente_id);
CREATE INDEX tickets_delivery_zone_idx ON public.tickets USING btree (delivery_zone) WHERE (delivery_zone IS NOT NULL);
CREATE INDEX tickets_last_activity_idx ON public.tickets USING btree (pinned DESC, last_activity_at DESC);
CREATE INDEX work_orders_ticket_id_idx ON public.work_orders USING btree (ticket_id);
CREATE UNIQUE INDEX productos_ticket_id_id_uq ON public.productos USING btree (ticket_id, id);
ALTER TABLE public."bitacora" ADD CONSTRAINT "bitacora_ticket_id_fkey" FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
ALTER TABLE public."chat_conversations" ADD CONSTRAINT "chat_conversations_member_a_fkey" FOREIGN KEY (member_a) REFERENCES profiles(id);
ALTER TABLE public."chat_conversations" ADD CONSTRAINT "chat_conversations_member_b_fkey" FOREIGN KEY (member_b) REFERENCES profiles(id);
ALTER TABLE public."chat_conversations" ADD CONSTRAINT "chat_conversations_ticket_id_fkey" FOREIGN KEY (ticket_id) REFERENCES tickets(id);
ALTER TABLE public."chat_later" ADD CONSTRAINT "chat_later_post_id_fkey" FOREIGN KEY (post_id) REFERENCES team_posts(id);
ALTER TABLE public."chat_later" ADD CONSTRAINT "chat_later_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id);
ALTER TABLE public."chat_read_state" ADD CONSTRAINT "chat_read_state_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE;
ALTER TABLE public."chat_read_state" ADD CONSTRAINT "chat_read_state_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public."chat_ticket_links" ADD CONSTRAINT "chat_ticket_links_linked_by_fkey" FOREIGN KEY (linked_by) REFERENCES profiles(id);
ALTER TABLE public."chat_ticket_links" ADD CONSTRAINT "chat_ticket_links_post_id_fkey" FOREIGN KEY (post_id) REFERENCES team_posts(id);
ALTER TABLE public."chat_ticket_links" ADD CONSTRAINT "chat_ticket_links_ticket_id_fkey" FOREIGN KEY (ticket_id) REFERENCES tickets(id);
ALTER TABLE public."chat_user_state" ADD CONSTRAINT "chat_user_state_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."client_notes" ADD CONSTRAINT "client_notes_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clientes(id);
ALTER TABLE public."client_tasks" ADD CONSTRAINT "client_tasks_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clientes(id);
ALTER TABLE public."clientes" ADD CONSTRAINT "clientes_merged_into_fkey" FOREIGN KEY (merged_into) REFERENCES clientes(id);
ALTER TABLE public."documentos" ADD CONSTRAINT "documentos_ticket_id_fkey" FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
ALTER TABLE public."feed_reactions" ADD CONSTRAINT "feed_reactions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."pagos" ADD CONSTRAINT "pagos_ticket_id_fkey" FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
ALTER TABLE public."productos" ADD CONSTRAINT "productos_ticket_id_fkey" FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."tareas" ADD CONSTRAINT "tareas_ticket_id_fkey" FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
ALTER TABLE public."tareas" ADD CONSTRAINT "tareas_work_order_ticket_fkey" FOREIGN KEY (ticket_id, work_order_id) REFERENCES work_orders(ticket_id, id) ON DELETE SET NULL (work_order_id);
ALTER TABLE public."team_posts" ADD CONSTRAINT "team_posts_author_user_id_fkey" FOREIGN KEY (author_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public."team_posts" ADD CONSTRAINT "team_posts_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id);
ALTER TABLE public."team_posts" ADD CONSTRAINT "team_posts_reply_to_id_fkey" FOREIGN KEY (reply_to_id) REFERENCES team_posts(id);
ALTER TABLE public."team_posts" ADD CONSTRAINT "team_posts_thread_root_id_fkey" FOREIGN KEY (thread_root_id) REFERENCES team_posts(id);
ALTER TABLE public."team_posts" ADD CONSTRAINT "team_posts_ticket_id_fkey" FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE SET NULL;
ALTER TABLE public."ticket_access" ADD CONSTRAINT "ticket_access_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public."ticket_access" ADD CONSTRAINT "ticket_access_ticket_id_fkey" FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
ALTER TABLE public."ticket_markers" ADD CONSTRAINT "ticket_markers_ticket_id_fkey" FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
ALTER TABLE public."tickets" ADD CONSTRAINT "tickets_cliente_id_fkey" FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL;
ALTER TABLE public."work_orders" ADD CONSTRAINT "work_orders_ticket_id_fkey" FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
ALTER TABLE public."work_orders" ADD CONSTRAINT "work_orders_ticket_id_product_id_fkey" FOREIGN KEY (ticket_id, product_id) REFERENCES productos(ticket_id, id) ON DELETE SET NULL (product_id);

CREATE OR REPLACE FUNCTION public.add_pago(p_ticket_id uuid, p_monto numeric, p_fecha date, p_metodo text, p_concepto text, p_client_op_id uuid)
 RETURNS pagos
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pago public.pagos;
BEGIN
  IF p_client_op_id IS NOT NULL THEN
    SELECT * INTO v_pago FROM public.pagos WHERE client_op_id = p_client_op_id;
    IF FOUND THEN
      RETURN v_pago;  -- reintento del MISMO intento: no duplica
    END IF;
  END IF;
 
  INSERT INTO public.pagos (ticket_id, monto, fecha, metodo, concepto, client_op_id)
  VALUES (p_ticket_id, p_monto, p_fecha, NULLIF(p_metodo, ''), NULLIF(p_concepto, ''), p_client_op_id)
  RETURNING * INTO v_pago;
 
  INSERT INTO public.bitacora (ticket_id, tipo, autor, payload)
  VALUES (
    p_ticket_id,
    'pago',
    COALESCE((SELECT display_name FROM public.profiles WHERE id = auth.uid()), NULL),
    jsonb_build_object('monto', p_monto, 'fecha', p_fecha, 'metodo', p_metodo, 'concepto', p_concepto)
  );
 
  RETURN v_pago;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.astra_guard_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'UPDATE' then
    if new.conversation_id is distinct from old.conversation_id
       or new.author_user_id is distinct from old.author_user_id
       or new.reply_to_id is distinct from old.reply_to_id
       or new.thread_root_id is distinct from old.thread_root_id
       or new.references_data is distinct from old.references_data then
      raise exception 'Immutable message identity';
    end if;
  end if;
  if tg_op = 'INSERT' then
    if new.reply_to_id is not null and not exists (
      select 1 from public.team_posts p where p.id = new.reply_to_id
      and p.conversation_id is not distinct from new.conversation_id
      and p.deleted_at is null
    ) then raise exception 'Reply outside conversation'; end if;
    if new.thread_root_id is not null and not exists (
      select 1 from public.team_posts p where p.id = new.thread_root_id
      and p.thread_root_id is null and p.conversation_id is not distinct from new.conversation_id
      and p.deleted_at is null
    ) then raise exception 'Invalid thread root'; end if;
    if new.thread_root_id is not null and new.reply_to_id is not null and not exists (
      select 1 from public.team_posts p where p.id=new.reply_to_id
      and (p.id=new.thread_root_id or p.thread_root_id=new.thread_root_id)
    ) then raise exception 'Reply outside thread'; end if;
  end if;
  -- The private-chat constraints must apply to UPDATE too: the existing post
  -- UPDATE policy permits authors to edit their own rows.
  if new.conversation_id is not null and (new.pin_level <> 'none' or new.mentions_all
    or new.expires_at is not null or new.ticket_id is not null )
  then raise exception 'Private message cannot broadcast, expire, or use legacy links or images'; end if;
  if new.image_storage_path is not null and new.conversation_id is not null and new.image_storage_path not like (new.conversation_id::text || '/%') then raise exception 'Image outside conversation'; end if;
  if new.file_storage_path is not null and (new.conversation_id is null or new.file_storage_path not like (new.conversation_id::text || '/%')) then raise exception 'File outside conversation'; end if;
  if new.audio_storage_path is not null and
    new.audio_storage_path not like (coalesce(new.conversation_id::text,'team') || '/%')
  then raise exception 'Audio path outside conversation'; end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.chat_can_view_scope(p_conversation_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select public.is_active_member() and (p_conversation_id is null or exists(
    select 1 from public.chat_conversations c where c.id=p_conversation_id
  ));
$function$
;
CREATE OR REPLACE FUNCTION public.chat_mark_scope_seen(p_conversation_id uuid, p_seen timestamp with time zone, p_mention_seen timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_seen timestamptz := coalesce(p_seen, now());
  v_mention timestamptz := coalesce(p_mention_seen, p_seen, now());
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_conversation_id is not null and not exists (
    select 1 from public.chat_conversations c where c.id = p_conversation_id
  ) then raise exception 'Conversation not available'; end if;

  insert into public.chat_read_state(user_id, conversation_id, last_seen_at, last_mention_seen_at, updated_at)
  values (v_uid, p_conversation_id, v_seen, v_mention, now())
  on conflict (user_id, scope_key) do update set
    last_seen_at = greatest(coalesce(public.chat_read_state.last_seen_at, '-infinity'::timestamptz), excluded.last_seen_at),
    last_mention_seen_at = greatest(coalesce(public.chat_read_state.last_mention_seen_at, '-infinity'::timestamptz), excluded.last_mention_seen_at),
    updated_at = now();
end
$function$
;
CREATE OR REPLACE FUNCTION public.chat_mark_seen(p_seen timestamp with time zone, p_mention_seen timestamp with time zone)
 RETURNS chat_user_state
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v public.chat_user_state;
BEGIN
  INSERT INTO public.chat_user_state (user_id, last_seen_at, last_mention_seen_at)
  VALUES (auth.uid(), p_seen, p_mention_seen)
  ON CONFLICT (user_id) DO UPDATE SET
    -- greatest() evita que una pestaña vieja "des-lea" lo que otra ya leyó.
    last_seen_at = greatest(coalesce(chat_user_state.last_seen_at, 'epoch'::timestamptz), coalesce(excluded.last_seen_at, 'epoch'::timestamptz)),
    last_mention_seen_at = greatest(coalesce(chat_user_state.last_mention_seen_at, 'epoch'::timestamptz), coalesce(excluded.last_mention_seen_at, 'epoch'::timestamptz)),
    updated_at = now()
  RETURNING * INTO v;
  RETURN v;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_notification_hours(p_at timestamp with time zone, p_all_hours boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(p_all_hours,false) or
    ((p_at at time zone 'America/Chicago')::time >= time '07:00'
      and (p_at at time zone 'America/Chicago')::time < time '18:00');
$function$
;
CREATE OR REPLACE FUNCTION public.chat_notification_kind_for_user(p_id uuid, p_user uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.team_posts; root uuid;
begin
 select * into p from public.team_posts where id=p_id;
 if not found or p.deleted_at is not null or p.author_user_id=p_user or (p.expires_at is not null and p.expires_at<=now()) or not public.chat_user_can_read_scope(p.conversation_id,p_user) then return null; end if;
 if exists(select 1 from public.chat_conversations c where c.id=p.conversation_id and c.kind='direct') then return 'personal'; end if;
 if p.mentions @> jsonb_build_array(jsonb_build_object('id',p_user::text)) then return 'mencion'; end if;
 if exists(select 1 from public.team_posts q where q.id=p.reply_to_id and q.author_user_id=p_user and q.deleted_at is null and q.conversation_id is not distinct from p.conversation_id) then return 'respuesta'; end if;
 root:=coalesce(p.thread_root_id,(select coalesce(q.thread_root_id,q.id) from public.team_posts q where q.id=p.reply_to_id and q.conversation_id is not distinct from p.conversation_id));
 if root is not null and exists(select 1 from public.team_posts q where q.id=root and q.author_user_id=p_user and q.deleted_at is null and q.conversation_id is not distinct from p.conversation_id) then return 'respuesta'; end if;
 return null;
end $function$
;
CREATE OR REPLACE FUNCTION public.chat_read_receipts(p_post_ids uuid[])
 RETURNS TABLE(post_id uuid, user_id uuid, display_name text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select p.id,r.user_id,pr.display_name
  from public.team_posts p
  join public.chat_read_state r on r.conversation_id is not distinct from p.conversation_id
    and r.last_seen_at >= p.created_at
  join public.profiles pr on pr.id=r.user_id and pr.active
  where public.is_active_member() and p.id=any(p_post_ids[1:250])
    and p.deleted_at is null and r.user_id<>p.author_user_id;
$function$
;
CREATE OR REPLACE FUNCTION public.chat_unread_count_for_user(p_user_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select count(*)::bigint
  from public.team_posts p
  where p.deleted_at is null
    and (p.expires_at is null or p.expires_at > now())
    and p.author_user_id is distinct from p_user_id
    and (
      p.conversation_id is null
      or exists (
        select 1
        from public.chat_conversations c
        where c.id = p.conversation_id
          and (
            (c.kind = 'direct' and p_user_id in (c.member_a, c.member_b))
            or
            (c.kind = 'ticket' and exists (
              select 1 from public.tickets t
              where t.id = c.ticket_id
                and (
                  t.visibility = 'team'
                  or exists (
                    select 1 from public.ticket_access a
                    where a.ticket_id = t.id and a.profile_id = p_user_id
                  )
                )
            ))
          )
      )
    )
    and p.created_at > coalesce(
      (
        select rs.last_seen_at
        from public.chat_read_state rs
        where rs.user_id = p_user_id
          and rs.conversation_id is not distinct from p.conversation_id
      ),
      case when p.conversation_id is null then (
        select st.last_seen_at from public.chat_user_state st where st.user_id = p_user_id
      ) end,
      (
        select nullif(s.values[1], '')::timestamptz
        from public.app_settings s where s.key = 'chat_unread_baseline'
      ),
      '1970-01-01 00:00:00+00'::timestamptz
    );
$function$
;
CREATE OR REPLACE FUNCTION public.chat_user_can_read_scope(p_scope uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists(select 1 from public.profiles pr where pr.id=p_user and pr.active)
  and (p_scope is null or exists(
    select 1 from public.chat_conversations c where c.id=p_scope and (
      (c.kind='direct' and p_user in(c.member_a,c.member_b)) or
      (c.kind='ticket' and exists(
        select 1 from public.tickets t where t.id=c.ticket_id and (
          t.visibility='team' or exists(select 1 from public.ticket_access a where a.ticket_id=t.id and a.profile_id=p_user)
        )
      ))
    )
  ));
$function$
;
CREATE OR REPLACE FUNCTION public.client_identity_key(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
 select lower(regexp_replace(btrim(p_name),'\s+',' ','g'));
$function$
;
CREATE OR REPLACE FUNCTION public.client_identity_resolve(p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare key text; found_id uuid; matches integer;
begin
 if current_user not in ('postgres','service_role') and (auth.uid() is null or not public.is_active_member()) then raise exception 'Solo miembros activos'; end if;
 key:=public.client_identity_key(p_name);
 if coalesce(key,'')='' then return null; end if;
 -- Concurrent ticket creations for the same name share a transaction lock.
 perform pg_advisory_xact_lock(hashtextextended(key,78012));
 select count(*), (array_agg(id order by created_at,id))[1] into matches,found_id
 from public.clientes where archived_at is null and public.client_identity_key(nombre)=key;
 if matches>1 then raise exception 'Hay varias fichas con ese nombre. Selecciona el cliente existente.'; end if;
 if found_id is null then
  insert into public.clientes(nombre) values(regexp_replace(btrim(p_name),'\s+',' ','g')) returning id into found_id;
 end if;
 return found_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.client_workspace_check_coverage(p_sources uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not public.is_active_member() then raise exception 'Solo miembros activos'; end if;
 if exists(select 1 from public.tickets t where t.cliente_id=any(p_sources) and not coalesce(public.ticket_is_visible_to_me(t.id),false)) then
  raise exception 'Este cliente contiene tickets que no puedes modificar. No se realizó ningún cambio.';
 end if;
end $function$
;
CREATE OR REPLACE FUNCTION public.client_workspace_flag(p_client uuid, p_flag text, p_value boolean, p_expected boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare n integer;
begin
 if not public.is_active_member() then raise exception 'Solo miembros activos'; end if;
 if p_flag='frequent_client' then update public.clientes set frequent_client=p_value where id=p_client and archived_at is null and frequent_client=p_expected;
 elsif p_flag='high_ticket' then update public.clientes set high_ticket=p_value where id=p_client and archived_at is null and high_ticket=p_expected;
 else raise exception 'Marca inválida'; end if;
 get diagnostics n=row_count;
 if n<>1 then raise exception 'La marca cambió. Actualiza la vista.'; end if;
 return p_value;
end $function$
;
CREATE OR REPLACE FUNCTION public.client_workspace_merge(p_target uuid, p_sources uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s public.clientes%rowtype; target public.clientes%rowtype; ids uuid[];
begin
 if not public.is_active_member() then raise exception 'Solo miembros activos'; end if;
 select array_agg(distinct x) into ids from unnest(p_sources) x where x<>p_target;
 if coalesce(cardinality(ids),0)=0 or cardinality(ids)>50 then raise exception 'Selecciona entre 2 y 51 clientes'; end if;
 perform 1 from public.clientes where id=p_target or id=any(ids) order by id for update;
 select * into target from public.clientes where id=p_target and archived_at is null;
 if target.id is null or (select count(*) from public.clientes where id=any(ids) and archived_at is null)<>cardinality(ids) then raise exception 'Los clientes cambiaron. Actualiza la vista.'; end if;
 perform public.client_workspace_check_coverage(ids);
 perform 1 from public.tickets where cliente_id=any(ids) order by id for update;
 for s in select * from public.clientes where id=any(ids) order by created_at,id loop
  if nullif(trim(s.notas_comerciales),'') is not null then
   insert into public.client_notes(client_id,body,author_name) values(p_target,left('Notas importadas de '||s.nombre||': '||s.notas_comerciales,2000),'Historial de clientes');
  end if;
  update public.clientes set telefono=coalesce(nullif(telefono,''),s.telefono),email=coalesce(nullif(email,''),s.email),
   empresa=coalesce(nullif(empresa,''),s.empresa),logo_storage_path=coalesce(nullif(logo_storage_path,''),s.logo_storage_path),
   frequent_client=frequent_client or s.frequent_client,high_ticket=high_ticket or s.high_ticket where id=p_target;
 end loop;
 update public.tickets set cliente_id=p_target,cliente=target.nombre where cliente_id=any(ids);
 update public.client_notes set client_id=p_target where client_id=any(ids);
 update public.client_tasks set client_id=p_target where client_id=any(ids);
 update public.clientes set archived_at=now(),merged_into=p_target where id=any(ids);
 return p_target;
end $function$
;
CREATE OR REPLACE FUNCTION public.client_workspace_reassign(p_ticket uuid, p_target uuid, p_expected_source uuid, p_resolution text DEFAULT 'keep'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare old_id uuid; target public.clientes%rowtype; n integer;
begin
 if not public.is_active_member() then raise exception 'Solo miembros activos'; end if;
 if p_resolution not in ('keep','merge','delete') then raise exception 'Opción inválida'; end if;
 perform 1 from public.clientes where id=p_target or id=p_expected_source order by id for update;
 select cliente_id into old_id from public.tickets where id=p_ticket for update;
 if not found or old_id is distinct from p_expected_source then raise exception 'El ticket cambió de cliente. Actualiza y vuelve a intentarlo.'; end if;
 select * into target from public.clientes where id=p_target and archived_at is null;
 if target.id is null then raise exception 'Cliente destino no disponible'; end if;
 if old_id=p_target then return p_target; end if;
 if p_resolution='merge' and old_id is not null then return public.client_workspace_merge(p_target,array[old_id]); end if;
 if p_resolution='delete' and old_id is not null then
  perform public.client_workspace_check_coverage(array[old_id]);
  if exists(select 1 from public.tickets where cliente_id=old_id and id<>p_ticket) then raise exception 'El cliente aún tiene otros tickets; elige fusionar o dejar como está.'; end if;
 end if;
 update public.tickets set cliente_id=p_target,cliente=target.nombre where id=p_ticket;
 get diagnostics n=row_count;
 if n<>1 then raise exception 'No tienes permiso para cambiar este ticket'; end if;
 if p_resolution='delete' and old_id is not null then
  insert into public.client_notes(client_id,body,author_name)
   select p_target,left('Notas importadas de '||nombre||': '||notas_comerciales,2000),'Historial de clientes'
   from public.clientes where id=old_id and nullif(trim(notas_comerciales),'') is not null;
  update public.client_notes set client_id=p_target where client_id=old_id;
  update public.client_tasks set client_id=p_target where client_id=old_id;
  update public.clientes set archived_at=now() where id=old_id;
 end if;
 return p_target;
end $function$
;
CREATE OR REPLACE FUNCTION public.enforce_profiles_privacy_flag_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.can_manage_privacy IS DISTINCT FROM OLD.can_manage_privacy THEN
    IF auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'can_manage_privacy no se puede cambiar desde la aplicación — solo por un administrador con acceso directo a la base de datos (SQL Editor).' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_ticket_client_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.clientes%rowtype; seen uuid[]:=array[]::uuid[]; resolve_name boolean:=false;
begin
 if new.cliente_id is not null then
  select * into c from public.clientes where id=new.cliente_id;
  if c.id is null then raise exception 'La ficha del cliente no está disponible'; end if;
  while c.archived_at is not null and c.merged_into is not null and not c.id=any(seen) loop
   seen:=array_append(seen,c.id);
   select * into c from public.clientes where id=c.merged_into;
   if c.id is null then raise exception 'La ficha fusionada no está disponible'; end if;
  end loop;
  if c.archived_at is not null then raise exception 'Selecciona una ficha de cliente activa'; end if;
  if tg_op='UPDATE' then
   resolve_name:=new.cliente_id is not distinct from old.cliente_id
    and new.cliente is distinct from old.cliente
    and coalesce(public.client_identity_key(new.cliente),'')<>coalesce(public.client_identity_key(c.nombre),'');
  end if;
  if not resolve_name then
   new.cliente_id:=c.id;
   new.cliente:=c.nombre;
   return new;
  end if;
 end if;
 if nullif(btrim(coalesce(new.cliente,'')),'') is not null then
  new.cliente_id:=public.client_identity_resolve(new.cliente);
 else
  new.cliente_id:=null;
 end if;
 return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.enforce_ticket_visibility_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.visibility IS DISTINCT FROM OLD.visibility THEN
    IF NOT public.is_privacy_manager() THEN
      RAISE EXCEPTION 'Solo un privacy manager puede cambiar la privacidad de un ticket — usa /privado o /publico.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.generate_document_numero()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.numero is null then
    if new.tipo = 'cotizacion' then
      new.numero := 'COT-' || nextval('cotizacion_seq');
    elsif new.tipo = 'invoice' then
      new.numero := 'INV-' || nextval('invoice_seq');
    end if;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, display_name, active)
  VALUES (
    new.id,
    COALESCE(NULLIF(new.raw_user_meta_data->>'display_name', ''), split_part(new.email, '@', 1)),
    true
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.is_active_member()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND active = true
  );
$function$
;
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND active = true AND role = 'admin'
  );
$function$
;
CREATE OR REPLACE FUNCTION public.is_privacy_manager()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND active = true AND can_manage_privacy = true
  );
$function$
;
CREATE OR REPLACE FUNCTION public.join_natural_list(names text[])
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN names IS NULL OR array_length(names,1) IS NULL THEN ''
    WHEN array_length(names,1) = 1 THEN names[1]
    ELSE array_to_string(names[1:array_length(names,1)-1], ', ') || ' y ' || names[array_length(names,1)]
  END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_post_pin(post_id uuid, new_pin_level text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor_name text;
BEGIN
  IF NOT is_active_member() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF new_pin_level NOT IN ('none','pin','megapin') THEN
    RAISE EXCEPTION 'pin_level inválido';
  END IF;
  IF new_pin_level = 'megapin' AND NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un admin puede usar Megapin';
  END IF;
  -- Quitar un Megapin existente también requiere admin (spec §11: "solo un
  -- admin puede crear/quitar Megapin") — cualquier miembro sí puede quitar
  -- un Pin normal ajeno.
  IF EXISTS (SELECT 1 FROM team_posts WHERE id = post_id AND pin_level = 'megapin') AND NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un admin puede quitar un Megapin';
  END IF;
  SELECT COALESCE(display_name, '') INTO actor_name FROM profiles WHERE id = auth.uid();
  UPDATE team_posts
     SET pin_level = new_pin_level,
         pinned_by = CASE WHEN new_pin_level = 'none' THEN NULL ELSE actor_name END,
         pinned_at = CASE WHEN new_pin_level = 'none' THEN NULL ELSE now() END
   WHERE id = post_id AND deleted_at IS NULL;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_ticket_delivery_dates(p_ticket_id uuid, p_delivery date, p_event date DEFAULT NULL::date, p_auxiliary jsonb DEFAULT NULL::jsonb, p_update_optional boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare affected integer; item jsonb; item_date date;
begin
  if not public.is_active_member() then raise exception 'Not authorized'; end if;
  if p_delivery is not null and p_delivery not between date '2000-01-01' and date '2100-12-31' then raise exception 'Invalid delivery date'; end if;
  if p_update_optional then
    if p_event is not null and p_event not between date '2000-01-01' and date '2100-12-31' then raise exception 'Invalid event date'; end if;
    if p_auxiliary is null or jsonb_typeof(p_auxiliary) <> 'array' then raise exception 'Invalid optional dates'; end if;
    if jsonb_array_length(p_auxiliary) > 50 then raise exception 'Too many optional dates'; end if;
    for item in select value from jsonb_array_elements(p_auxiliary) loop
      if jsonb_typeof(item) <> 'object' or coalesce(item->>'kind','') not in ('partial','deadline') or coalesce(item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' or length(coalesce(item->>'label','')) > 120 then raise exception 'Invalid optional date'; end if;
      item_date := (item->>'date')::date;
      if item_date not between date '2000-01-01' and date '2100-12-31' then raise exception 'Invalid optional date'; end if;
    end loop;
  end if;
  update public.tickets set fecha_compromiso = p_delivery,
    fecha_evento = case when p_update_optional then p_event else fecha_evento end,
    fechas_auxiliares = case when p_update_optional then p_auxiliary else fechas_auxiliares end
    where id = p_ticket_id;
  get diagnostics affected = row_count;
  if affected = 0 then return false; end if;
  insert into public.bitacora(ticket_id,tipo,autor,payload) values(p_ticket_id,'sistema',(select display_name from public.profiles where id=auth.uid()),jsonb_build_object('text',case when p_update_optional then 'Fecha de entrega y fechas opcionales actualizadas' else 'Fecha de entrega actualizada' end,'fecha_compromiso',p_delivery,'optional_dates_changed',p_update_optional));
  return true;
end $function$
;
CREATE OR REPLACE FUNCTION public.set_ticket_delivery_dates_checked(p_ticket_id uuid, p_expected jsonb, p_delivery date, p_event date DEFAULT NULL::date, p_auxiliary jsonb DEFAULT NULL::jsonb, p_update_optional boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.tickets; col text; current_row jsonb;
begin
 if auth.uid() is null or not public.is_active_member() then raise exception 'Authentication required'; end if;
 select * into t from public.tickets where id=p_ticket_id for update;
 if not found then raise exception 'Record unavailable'; end if;
 current_row:=to_jsonb(t);
 if jsonb_typeof(p_expected) is distinct from 'object' or not p_expected ? 'fecha_compromiso' or (p_update_optional and not(p_expected ? 'fecha_evento' and p_expected ? 'fechas_auxiliares')) then raise exception 'Missing original dates'; end if;
 for col in select unnest(case when p_update_optional then array['fecha_compromiso','fecha_evento','fechas_auxiliares'] else array['fecha_compromiso'] end) loop
  if current_row->col is distinct from p_expected->col then raise exception using errcode='40001',message='EDIT_CONFLICT: Otra persona cambió las fechas. Revisa el valor actual antes de guardar.'; end if;
 end loop;
 return public.set_ticket_delivery_dates(p_ticket_id,p_delivery,p_event,p_auxiliary,p_update_optional);
end $function$
;
CREATE OR REPLACE FUNCTION public.set_ticket_work_dates(p_ticket_id uuid, p_promised date, p_event date)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare affected integer;
begin
  if not public.is_active_member() then raise exception 'Not authorized'; end if;
  if (p_promised is not null and p_promised not between date '2000-01-01' and date '2100-12-31') or (p_event is not null and p_event not between date '2000-01-01' and date '2100-12-31') then raise exception 'Invalid date'; end if;
  update public.tickets set fecha_compromiso=p_promised,fecha_evento=p_event where id=p_ticket_id;
  get diagnostics affected = row_count;
  if affected=0 then return false; end if;
  insert into public.bitacora(ticket_id,tipo,autor,payload) values(p_ticket_id,'sistema',(select display_name from public.profiles where id=auth.uid()),jsonb_build_object('text','Fechas de entrega y evento actualizadas','fecha_compromiso',p_promised,'fecha_evento',p_event));
  return true;
end $function$
;
CREATE OR REPLACE FUNCTION public.storage_ticket_id_from_path(p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  seg text;
BEGIN
  seg := split_part(p_name, '/', 1);
  BEGIN
    RETURN seg::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.team_posts_guard_push_flag()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.push_sent_at IS DISTINCT FROM OLD.push_sent_at
     AND current_user <> (SELECT tableowner FROM pg_tables WHERE schemaname='public' AND tablename='team_posts')
  THEN
    NEW.push_sent_at := OLD.push_sent_at;   -- en silencio: no es un oráculo
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.ticket_is_visible_to_me(p_ticket_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = p_ticket_id
      AND (
        t.visibility = 'team'
        OR EXISTS (
          SELECT 1 FROM public.ticket_access ta
          WHERE ta.ticket_id = t.id AND ta.profile_id = auth.uid()
        )
      )
  );
$function$
;
CREATE OR REPLACE FUNCTION public.ticket_set_private(p_ticket_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_id     uuid := auth.uid();
  v_actor_name   text;
  v_manager_ids  uuid[];
  v_manager_names text[];
  v_bitacora_text text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_active_member() THEN
    RAISE EXCEPTION 'No autorizado: no eres un miembro activo.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_privacy_manager() THEN
    RAISE EXCEPTION 'No autorizado: solo un privacy manager puede restringir un ticket.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tickets WHERE id = p_ticket_id) THEN
    RAISE EXCEPTION 'Ticket no encontrado.' USING ERRCODE = 'P0002';
  END IF;

  SELECT display_name INTO v_actor_name FROM public.profiles WHERE id = v_actor_id;
  v_actor_name := COALESCE(NULLIF(v_actor_name, ''), 'Alguien');

  -- La regla operativa inmediata: privado = "los privacy managers
  -- actuales", nunca una lista arbitraria pasada por el llamador — por
  -- diseño, este RPC ni siquiera acepta una lista de nombres/ids como
  -- parámetro.
  SELECT array_agg(id ORDER BY created_at), array_agg(display_name ORDER BY created_at)
    INTO v_manager_ids, v_manager_names
    FROM public.profiles
    WHERE can_manage_privacy = true AND active = true;

  IF v_manager_ids IS NULL OR array_length(v_manager_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No hay privacy managers activos configurados — no se puede restringir el ticket (nadie quedaría con acceso).' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.ticket_access WHERE ticket_id = p_ticket_id;
  INSERT INTO public.ticket_access (ticket_id, profile_id)
    SELECT p_ticket_id, unnest(v_manager_ids);

  UPDATE public.tickets SET visibility = 'private' WHERE id = p_ticket_id;

  v_bitacora_text := v_actor_name || ' restringió el ticket a ' || public.join_natural_list(v_manager_names) || '.';
  INSERT INTO public.bitacora (ticket_id, tipo, autor, payload)
    VALUES (p_ticket_id, 'sistema', v_actor_name, jsonb_build_object('text', v_bitacora_text));
END;
$function$
;
CREATE OR REPLACE FUNCTION public.ticket_set_public(p_ticket_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_id   uuid := auth.uid();
  v_actor_name text;
  v_visibility text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_active_member() THEN
    RAISE EXCEPTION 'No autorizado: no eres un miembro activo.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_privacy_manager() THEN
    RAISE EXCEPTION 'No autorizado: solo un privacy manager puede hacer público un ticket.' USING ERRCODE = '42501';
  END IF;

  SELECT visibility INTO v_visibility FROM public.tickets WHERE id = p_ticket_id;
  IF v_visibility IS NULL THEN
    RAISE EXCEPTION 'Ticket no encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_visibility <> 'private' THEN
    RAISE EXCEPTION 'Este ticket ya es público.' USING ERRCODE = 'P0001';
  END IF;

  SELECT display_name INTO v_actor_name FROM public.profiles WHERE id = v_actor_id;
  v_actor_name := COALESCE(NULLIF(v_actor_name, ''), 'Alguien');

  UPDATE public.tickets SET visibility = 'team' WHERE id = p_ticket_id;
  DELETE FROM public.ticket_access WHERE ticket_id = p_ticket_id;

  INSERT INTO public.bitacora (ticket_id, tipo, autor, payload)
    VALUES (p_ticket_id, 'sistema', v_actor_name, jsonb_build_object('text', v_actor_name || ' hizo público el ticket (antes: restringido).'));
END;
$function$
;
CREATE OR REPLACE FUNCTION public.touch_ticket_from_child()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  update tickets set last_activity_at = now()
    where id = coalesce(new.ticket_id, old.ticket_id);
  return coalesce(new, old);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.touch_ticket_on_field_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.cliente is distinct from old.cliente
     or new.que_sigue is distinct from old.que_sigue
     or new.responsable is distinct from old.responsable
     or new.fecha_atencion is distinct from old.fecha_atencion
     or new.fecha_compromiso is distinct from old.fecha_compromiso then
    new.last_activity_at := now();
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.workspace_patch_record(p_table text, p_id uuid, p_patch jsonb, p_expected jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare allowed text[]; current_row jsonb; result_row jsonb; col text; assignments text;
begin
 if auth.uid() is null or not public.is_active_member() then raise exception 'Authentication required'; end if;
 allowed:=case p_table
 when 'tickets' then array['cliente','responsable','fecha_atencion','fecha_compromiso','fecha_evento','delivery_zone','que_sigue']
 when 'clientes' then array['nombre','empresa','telefono','email','notas_comerciales','preautorizado','tax_exempt','tax_exempt_reason','tax_exempt_ref','logo_storage_path','accent_theme','visual_style']
 when 'productos' then array['descripcion','cantidad','precio']
 when 'tareas' then array['descripcion','responsable','area','estado','progreso','tipo_operacion','fecha_atencion','work_order_id','action_code','action_path','terminado_at'] end;
 if allowed is null or jsonb_typeof(p_patch) is distinct from 'object' or jsonb_typeof(p_expected) is distinct from 'object' or p_patch='{}'::jsonb then raise exception 'Invalid edit'; end if;
 for col in select jsonb_object_keys(p_patch) loop
  if not col=any(allowed) or not p_expected ? col then raise exception 'Invalid field'; end if;
  if col like 'fecha_%' and p_patch->>col is not null and ((p_patch->>col)::date not between date '2000-01-01' and date '2100-12-31') then raise exception 'Invalid date'; end if;
 end loop;
 execute format('select to_jsonb(r) from public.%I r where id=$1 for update',p_table) into current_row using p_id;
 if current_row is null then raise exception 'Record unavailable'; end if;
 for col in select jsonb_object_keys(p_patch) loop
  if coalesce(nullif(current_row->col,'""'::jsonb),'null'::jsonb) is distinct from coalesce(nullif(p_expected->col,'""'::jsonb),'null'::jsonb)
    and current_row->col is distinct from p_patch->col then
   raise exception using errcode='40001',message='EDIT_CONFLICT: Otra persona cambió este campo. Revisa el valor actual antes de guardar.',detail=current_row::text;
  end if;
 end loop;
 select string_agg(format('%I=v.%I',k,k),',') into assignments from jsonb_object_keys(p_patch) k;
 execute format('update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I,$1) v where t.id=$2 returning to_jsonb(t)',p_table,assignments) into result_row using p_patch,p_id;
 return result_row;
end $function$
;
CREATE TRIGGER trg_touch_ticket_bitacora AFTER INSERT ON public.bitacora FOR EACH ROW EXECUTE FUNCTION touch_ticket_from_child();
CREATE TRIGGER trg_generate_document_numero BEFORE INSERT ON public.documentos FOR EACH ROW EXECUTE FUNCTION generate_document_numero();
CREATE TRIGGER trg_touch_ticket_documentos AFTER INSERT OR DELETE OR UPDATE ON public.documentos FOR EACH ROW EXECUTE FUNCTION touch_ticket_from_child();
CREATE TRIGGER trg_touch_ticket_pagos AFTER INSERT OR DELETE OR UPDATE ON public.pagos FOR EACH ROW EXECUTE FUNCTION touch_ticket_from_child();
CREATE TRIGGER trg_touch_ticket_productos AFTER INSERT OR DELETE OR UPDATE ON public.productos FOR EACH ROW EXECUTE FUNCTION touch_ticket_from_child();
CREATE TRIGGER trg_enforce_profiles_privacy_flag_change BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION enforce_profiles_privacy_flag_change();
CREATE TRIGGER trg_touch_ticket_tareas AFTER INSERT OR DELETE OR UPDATE ON public.tareas FOR EACH ROW EXECUTE FUNCTION touch_ticket_from_child();
CREATE TRIGGER astra_guard_post BEFORE INSERT OR UPDATE ON public.team_posts FOR EACH ROW EXECUTE FUNCTION astra_guard_post();
CREATE TRIGGER team_posts_guard_push_flag_trg BEFORE UPDATE ON public.team_posts FOR EACH ROW EXECUTE FUNCTION team_posts_guard_push_flag();
CREATE TRIGGER trg_enforce_ticket_visibility_change BEFORE UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION enforce_ticket_visibility_change();
CREATE TRIGGER trg_ensure_ticket_client_identity BEFORE INSERT OR UPDATE OF cliente, cliente_id ON public.tickets FOR EACH ROW EXECUTE FUNCTION enforce_ticket_client_identity();
CREATE TRIGGER trg_touch_ticket_fields BEFORE UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION touch_ticket_on_field_change();
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
CREATE POLICY "app_bug_reports_insert_own" ON public."app_bug_reports" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((created_by = auth.uid()));
CREATE POLICY "app_bug_reports_select_own" ON public."app_bug_reports" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((created_by = auth.uid()));
CREATE POLICY "app_bug_reports_update_own" ON public."app_bug_reports" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((created_by = auth.uid())) WITH CHECK ((created_by = auth.uid()));
CREATE POLICY "bug_reports_insert_own" ON public."app_bug_reports" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((created_by = auth.uid()));
CREATE POLICY "bug_reports_select_own" ON public."app_bug_reports" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((created_by = auth.uid()));
CREATE POLICY "bug_reports_update_own" ON public."app_bug_reports" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((created_by = auth.uid())) WITH CHECK ((created_by = auth.uid()));
CREATE POLICY "app_settings_active_members" ON public."app_settings" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_active_member()) WITH CHECK (is_active_member());
CREATE POLICY "authenticated read/write app_settings" ON public."app_settings" AS PERMISSIVE FOR ALL TO "public" USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "bitacora_active_members" ON public."bitacora" AS PERMISSIVE FOR ALL TO "authenticated" USING ((is_active_member() AND ticket_is_visible_to_me(ticket_id))) WITH CHECK ((is_active_member() AND ticket_is_visible_to_me(ticket_id)));
CREATE POLICY "chat_conversations_create" ON public."chat_conversations" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_active_member() AND (((kind = 'ticket'::text) AND ticket_is_visible_to_me(ticket_id)) OR ((kind = 'direct'::text) AND ((member_a = ( SELECT auth.uid() AS uid)) OR (member_b = ( SELECT auth.uid() AS uid))) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = chat_conversations.member_a) AND p.active))) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = chat_conversations.member_b) AND p.active)))))));
CREATE POLICY "chat_conversations_read" ON public."chat_conversations" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_active_member() AND (((kind = 'direct'::text) AND ((member_a = ( SELECT auth.uid() AS uid)) OR (member_b = ( SELECT auth.uid() AS uid)))) OR ((kind = 'ticket'::text) AND ticket_is_visible_to_me(ticket_id)))));
CREATE POLICY "chat_later_own" ON public."chat_later" AS PERMISSIVE FOR ALL TO "authenticated" USING ((is_active_member() AND (user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM team_posts p
  WHERE ((p.id = chat_later.post_id) AND (p.deleted_at IS NULL)))))) WITH CHECK ((is_active_member() AND (user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM team_posts p
  WHERE ((p.id = chat_later.post_id) AND (p.deleted_at IS NULL))))));
CREATE POLICY "chat_read_state_own" ON public."chat_read_state" AS PERMISSIVE FOR ALL TO "authenticated" USING ((is_active_member() AND (user_id = ( SELECT auth.uid() AS uid)))) WITH CHECK ((is_active_member() AND (user_id = ( SELECT auth.uid() AS uid)) AND ((conversation_id IS NULL) OR (EXISTS ( SELECT 1
   FROM chat_conversations c
  WHERE (c.id = chat_read_state.conversation_id))))));
CREATE POLICY "chat_read_state_visible_scope" ON public."chat_read_state" AS PERMISSIVE FOR SELECT TO "authenticated" USING (chat_can_view_scope(conversation_id));
CREATE POLICY "chat_ticket_links_read" ON public."chat_ticket_links" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_active_member() AND ticket_is_visible_to_me(ticket_id)));
CREATE POLICY "chat_ticket_links_write" ON public."chat_ticket_links" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_active_member() AND (linked_by = ( SELECT auth.uid() AS uid)) AND ticket_is_visible_to_me(ticket_id) AND (EXISTS ( SELECT 1
   FROM team_posts p
  WHERE ((p.id = chat_ticket_links.post_id) AND (p.conversation_id IS NULL) AND (p.deleted_at IS NULL) AND ((chat_ticket_links.link_kind = 'message'::text) OR (p.thread_root_id IS NULL)))))));
CREATE POLICY "chat_user_state_own" ON public."chat_user_state" AS PERMISSIVE FOR ALL TO "public" USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "client_notes_insert" ON public."client_notes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_active_member() AND (author_user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM clientes c
  WHERE ((c.id = client_notes.client_id) AND (c.archived_at IS NULL))))));
CREATE POLICY "client_notes_move" ON public."client_notes" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_active_member()) WITH CHECK (is_active_member());
CREATE POLICY "client_notes_read" ON public."client_notes" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_active_member());
CREATE POLICY "client_tasks_insert" ON public."client_tasks" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_active_member() AND (created_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM clientes c
  WHERE ((c.id = client_tasks.client_id) AND (c.archived_at IS NULL))))));
CREATE POLICY "client_tasks_read" ON public."client_tasks" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_active_member());
CREATE POLICY "client_tasks_update" ON public."client_tasks" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_active_member()) WITH CHECK (is_active_member());
CREATE POLICY "authenticated read/write clientes" ON public."clientes" AS PERMISSIVE FOR ALL TO "public" USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY "clientes_active_members" ON public."clientes" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_active_member()) WITH CHECK (is_active_member());
CREATE POLICY "documentos_active_members" ON public."documentos" AS PERMISSIVE FOR ALL TO "authenticated" USING ((is_active_member() AND ticket_is_visible_to_me(ticket_id))) WITH CHECK ((is_active_member() AND ticket_is_visible_to_me(ticket_id)));
CREATE POLICY "feed_reactions_delete_own" ON public."feed_reactions" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((is_active_member() AND (user_id = auth.uid())));
CREATE POLICY "feed_reactions_insert" ON public."feed_reactions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_active_member() AND (user_id = ( SELECT auth.uid() AS uid)) AND ((target_type <> 'post'::text) OR (EXISTS ( SELECT 1
   FROM team_posts p
  WHERE (((p.id)::text = feed_reactions.target_id) AND (p.deleted_at IS NULL)))))));
CREATE POLICY "feed_reactions_select" ON public."feed_reactions" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_active_member() AND ((target_type <> 'post'::text) OR (EXISTS ( SELECT 1
   FROM team_posts p
  WHERE (((p.id)::text = feed_reactions.target_id) AND (p.deleted_at IS NULL)))))));
CREATE POLICY "feed_reactions_update_own" ON public."feed_reactions" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((is_active_member() AND (user_id = ( SELECT auth.uid() AS uid)))) WITH CHECK ((is_active_member() AND (user_id = ( SELECT auth.uid() AS uid)) AND ((target_type <> 'post'::text) OR (EXISTS ( SELECT 1
   FROM team_posts p
  WHERE (((p.id)::text = feed_reactions.target_id) AND (p.deleted_at IS NULL)))))));
CREATE POLICY "pagos_active_members" ON public."pagos" AS PERMISSIVE FOR ALL TO "authenticated" USING ((is_active_member() AND ticket_is_visible_to_me(ticket_id))) WITH CHECK ((is_active_member() AND ticket_is_visible_to_me(ticket_id)));
CREATE POLICY "productos_active_members" ON public."productos" AS PERMISSIVE FOR ALL TO "authenticated" USING ((is_active_member() AND ticket_is_visible_to_me(ticket_id))) WITH CHECK ((is_active_member() AND ticket_is_visible_to_me(ticket_id)));
CREATE POLICY "profiles_select_active_members" ON public."profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_active_member());
CREATE POLICY "profiles_update_own" ON public."profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((id = auth.uid())) WITH CHECK ((id = auth.uid()));
CREATE POLICY "push_subscriptions_own" ON public."push_subscriptions" AS PERMISSIVE FOR ALL TO "public" USING ((user_id = auth.uid())) WITH CHECK (((user_id = auth.uid()) AND is_active_member()));
CREATE POLICY "tareas_active_members" ON public."tareas" AS PERMISSIVE FOR ALL TO "authenticated" USING ((is_active_member() AND ticket_is_visible_to_me(ticket_id))) WITH CHECK ((is_active_member() AND ticket_is_visible_to_me(ticket_id)));
CREATE POLICY "team_posts_insert" ON public."team_posts" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_active_member() AND (author_user_id = ( SELECT auth.uid() AS uid)) AND (pin_level <> 'megapin'::text) AND ((conversation_id IS NULL) OR (EXISTS ( SELECT 1
   FROM chat_conversations c
  WHERE (c.id = team_posts.conversation_id))))));
CREATE POLICY "team_posts_select" ON public."team_posts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_active_member() AND ((conversation_id IS NULL) OR (EXISTS ( SELECT 1
   FROM chat_conversations c
  WHERE (c.id = team_posts.conversation_id))))));
CREATE POLICY "team_posts_update_own_or_admin" ON public."team_posts" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((is_active_member() AND ((author_user_id = ( SELECT auth.uid() AS uid)) OR is_admin()) AND ((conversation_id IS NULL) OR (EXISTS ( SELECT 1
   FROM chat_conversations c
  WHERE (c.id = team_posts.conversation_id)))))) WITH CHECK ((is_active_member() AND ((author_user_id = ( SELECT auth.uid() AS uid)) OR is_admin()) AND ((pin_level <> 'megapin'::text) OR is_admin()) AND ((conversation_id IS NULL) OR (EXISTS ( SELECT 1
   FROM chat_conversations c
  WHERE (c.id = team_posts.conversation_id))))));
CREATE POLICY "ticket_access_select_visible" ON public."ticket_access" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_active_member() AND ticket_is_visible_to_me(ticket_id)));
CREATE POLICY "ticket_markers_active_members" ON public."ticket_markers" AS PERMISSIVE FOR ALL TO "authenticated" USING ((is_active_member() AND ticket_is_visible_to_me(ticket_id))) WITH CHECK ((is_active_member() AND ticket_is_visible_to_me(ticket_id)));
CREATE POLICY "tickets_delete_visible" ON public."tickets" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((is_active_member() AND ticket_is_visible_to_me(id)));
CREATE POLICY "tickets_insert_active_members" ON public."tickets" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (is_active_member());
CREATE POLICY "tickets_select_visible" ON public."tickets" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_active_member() AND ((visibility = 'team'::text) OR ticket_is_visible_to_me(id))));
CREATE POLICY "tickets_update_visible" ON public."tickets" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((is_active_member() AND ticket_is_visible_to_me(id))) WITH CHECK ((is_active_member() AND ticket_is_visible_to_me(id)));
CREATE POLICY "work_orders_delete" ON public."work_orders" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((is_active_member() AND ticket_is_visible_to_me(ticket_id)));
CREATE POLICY "work_orders_insert" ON public."work_orders" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_active_member() AND ticket_is_visible_to_me(ticket_id)));
CREATE POLICY "work_orders_read" ON public."work_orders" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_active_member() AND ticket_is_visible_to_me(ticket_id)));
CREATE POLICY "work_orders_update" ON public."work_orders" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((is_active_member() AND ticket_is_visible_to_me(ticket_id))) WITH CHECK ((is_active_member() AND ticket_is_visible_to_me(ticket_id)));
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
REVOKE ALL ON public.push_subscriptions FROM authenticated;
SET check_function_bodies = on;
CREATE INDEX clientes_identity_lookup ON public.clientes USING btree (client_identity_key(nombre)) WHERE (archived_at IS NULL);
-- Trigger functions cannot be called directly; internal service helpers are not exposed.
DO $$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.prorettype='trigger'::regtype OR p.proname IN ('chat_user_can_read_scope','chat_notification_kind_for_user','chat_unread_count_for_user')) LOOP EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated',f.signature); END LOOP; END $$;
