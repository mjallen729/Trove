export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1";
  };
  public: {
    Tables: {
      app_config: {
        Row: {
          key: string;
          value: string;
        };
        Insert: {
          key: string;
          value: string;
        };
        Update: {
          key?: string;
          value?: string;
        };
        Relationships: [];
      };
      storage_transacts: {
        Row: {
          created_at: string | null;
          id: string;
          previous_transact: string | null;
          storage_bytes: number;
          transaction_uid: string;
          vault_uid: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          previous_transact?: string | null;
          storage_bytes: number;
          transaction_uid: string;
          vault_uid: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          previous_transact?: string | null;
          storage_bytes?: number;
          transaction_uid?: string;
          vault_uid?: string;
        };
        Relationships: [
          {
            foreignKeyName: "storage_transacts_previous_transact_fkey";
            columns: ["previous_transact"];
            isOneToOne: false;
            referencedRelation: "storage_transacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "storage_transacts_vault_uid_fkey";
            columns: ["vault_uid"];
            isOneToOne: false;
            referencedRelation: "vaults";
            referencedColumns: ["uid"];
          },
        ];
      };
      uploads: {
        Row: {
          created_at: string | null;
          file_name_encrypted: string | null;
          file_uid: string;
          received_chunks: number[] | null;
          total_chunks: number;
          upload_id: string;
          vault_uid: string;
        };
        Insert: {
          created_at?: string | null;
          file_name_encrypted?: string | null;
          file_uid: string;
          received_chunks?: number[] | null;
          total_chunks: number;
          upload_id?: string;
          vault_uid: string;
        };
        Update: {
          created_at?: string | null;
          file_name_encrypted?: string | null;
          file_uid?: string;
          received_chunks?: number[] | null;
          total_chunks?: number;
          upload_id?: string;
          vault_uid?: string;
        };
        Relationships: [
          {
            foreignKeyName: "uploads_vault_uid_fkey";
            columns: ["vault_uid"];
            isOneToOne: false;
            referencedRelation: "vaults";
            referencedColumns: ["uid"];
          },
        ];
      };
      vault_sessions: {
        Row: {
          created_at: string | null;
          expires_at: string;
          id: string;
          token_hash: string;
          vault_uid: string;
        };
        Insert: {
          created_at?: string | null;
          expires_at: string;
          id?: string;
          token_hash: string;
          vault_uid: string;
        };
        Update: {
          created_at?: string | null;
          expires_at?: string;
          id?: string;
          token_hash?: string;
          vault_uid?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vault_sessions_vault_uid_fkey";
            columns: ["vault_uid"];
            isOneToOne: false;
            referencedRelation: "vaults";
            referencedColumns: ["uid"];
          },
        ];
      };
      vaults: {
        Row: {
          burn_at: string | null;
          created_at: string | null;
          manifest_cipher: string;
          storage_limit: number | null;
          storage_used: number | null;
          uid: string;
        };
        Insert: {
          burn_at?: string | null;
          created_at?: string | null;
          manifest_cipher: string;
          storage_limit?: number | null;
          storage_used?: number | null;
          uid: string;
        };
        Update: {
          burn_at?: string | null;
          created_at?: string | null;
          manifest_cipher?: string;
          storage_limit?: number | null;
          storage_used?: number | null;
          uid?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      append_received_chunk: {
        Args: { p_chunk_index: number; p_file_uid: string };
        Returns: undefined;
      };
      cleanup_expired_sessions: { Args: never; Returns: number };
      get_app_config: { Args: { config_key: string }; Returns: string };
      validate_storage_session: {
        Args: { raw_token: string };
        Returns: string;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
