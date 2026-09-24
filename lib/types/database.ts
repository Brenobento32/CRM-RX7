export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      atividades: {
        Row: {
          cliente_id: string
          created_at: string
          data: string
          descricao: string
          id: string
          negociacao_id: string | null
          tipo: Database["public"]["Enums"]["tipo_atividade"]
          usuario_id: string
        }
        Insert: {
          cliente_id: string
          created_at?: string
          data?: string
          descricao: string
          id?: string
          negociacao_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_atividade"]
          usuario_id?: string
        }
        Update: {
          cliente_id?: string
          created_at?: string
          data?: string
          descricao?: string
          id?: string
          negociacao_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_atividade"]
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "atividades_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atividades_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "atividades_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atividades_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "negociacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atividades_owner_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          cargo: string | null
          cnpj: string | null
          cpf: string | null
          created_at: string
          deleted_at: string | null
          documento: string | null
          email: string | null
          empresa: string | null
          id: string
          nome: string
          observacoes: string | null
          origem: string | null
          owner_id: string
          responsavel: string | null
          telefone: string | null
          tipo_cliente: Database["public"]["Enums"]["tipo_cliente"]
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          cargo?: string | null
          cnpj?: string | null
          cpf?: string | null
          created_at?: string
          deleted_at?: string | null
          documento?: string | null
          email?: string | null
          empresa?: string | null
          id?: string
          nome: string
          observacoes?: string | null
          origem?: string | null
          owner_id: string
          responsavel?: string | null
          telefone?: string | null
          tipo_cliente?: Database["public"]["Enums"]["tipo_cliente"]
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          cargo?: string | null
          cnpj?: string | null
          cpf?: string | null
          created_at?: string
          deleted_at?: string | null
          documento?: string | null
          email?: string | null
          empresa?: string | null
          id?: string
          nome?: string
          observacoes?: string | null
          origem?: string | null
          owner_id?: string
          responsavel?: string | null
          telefone?: string | null
          tipo_cliente?: Database["public"]["Enums"]["tipo_cliente"]
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      etapas_funil: {
        Row: {
          ativo: boolean
          chave: string | null
          cor: Database["public"]["Enums"]["cor_etapa"]
          created_at: string
          criado_por: string | null
          id: string
          nome: string
          ordem: number
          sistema: boolean
          tipo: Database["public"]["Enums"]["tipo_etapa"]
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          chave?: string | null
          cor: Database["public"]["Enums"]["cor_etapa"]
          created_at?: string
          criado_por?: string | null
          id?: string
          nome: string
          ordem: number
          sistema?: boolean
          tipo?: Database["public"]["Enums"]["tipo_etapa"]
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          chave?: string | null
          cor?: Database["public"]["Enums"]["cor_etapa"]
          created_at?: string
          criado_por?: string | null
          id?: string
          nome?: string
          ordem?: number
          sistema?: boolean
          tipo?: Database["public"]["Enums"]["tipo_etapa"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "etapas_funil_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      eventos: {
        Row: {
          cliente_id: string
          created_at: string
          descricao: string | null
          fim: string
          google_event_id: string | null
          id: string
          inicio: string
          negociacao_id: string | null
          sincronizado_em: string | null
          status: Database["public"]["Enums"]["status_evento"]
          tipo: Database["public"]["Enums"]["tipo_evento"]
          titulo: string
          updated_at: string
          usuario_id: string
        }
        Insert: {
          cliente_id: string
          created_at?: string
          descricao?: string | null
          fim: string
          google_event_id?: string | null
          id?: string
          inicio: string
          negociacao_id?: string | null
          sincronizado_em?: string | null
          status?: Database["public"]["Enums"]["status_evento"]
          tipo?: Database["public"]["Enums"]["tipo_evento"]
          titulo: string
          updated_at?: string
          usuario_id?: string
        }
        Update: {
          cliente_id?: string
          created_at?: string
          descricao?: string | null
          fim?: string
          google_event_id?: string | null
          id?: string
          inicio?: string
          negociacao_id?: string | null
          sincronizado_em?: string | null
          status?: Database["public"]["Enums"]["status_evento"]
          tipo?: Database["public"]["Enums"]["tipo_evento"]
          titulo?: string
          updated_at?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eventos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "eventos_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "negociacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_owner_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fechamentos: {
        Row: {
          contrato_assinado: boolean
          contrato_assinado_em: string | null
          contrato_enviado: boolean
          contrato_enviado_em: string | null
          created_at: string
          data_fechamento: string
          fechado_em: string
          fechado_por: string
          link_contrato: string | null
          negociacao_id: string
          responsavel_id: string
          status_onboarding: Database["public"]["Enums"]["status_onboarding"]
          status_pagamento: Database["public"]["Enums"]["status_pagamento"]
          updated_at: string
          valor_vendido: number
        }
        Insert: {
          contrato_assinado: boolean
          contrato_assinado_em?: string | null
          contrato_enviado: boolean
          contrato_enviado_em?: string | null
          created_at?: string
          data_fechamento: string
          fechado_em?: string
          fechado_por?: string
          link_contrato?: string | null
          negociacao_id: string
          responsavel_id: string
          status_onboarding: Database["public"]["Enums"]["status_onboarding"]
          status_pagamento: Database["public"]["Enums"]["status_pagamento"]
          updated_at?: string
          valor_vendido: number
        }
        Update: {
          contrato_assinado?: boolean
          contrato_assinado_em?: string | null
          contrato_enviado?: boolean
          contrato_enviado_em?: string | null
          created_at?: string
          data_fechamento?: string
          fechado_em?: string
          fechado_por?: string
          link_contrato?: string | null
          negociacao_id?: string
          responsavel_id?: string
          status_onboarding?: Database["public"]["Enums"]["status_onboarding"]
          status_pagamento?: Database["public"]["Enums"]["status_pagamento"]
          updated_at?: string
          valor_vendido?: number
        }
        Relationships: [
          {
            foreignKeyName: "fechamentos_fechado_por_fkey"
            columns: ["fechado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fechamentos_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: true
            referencedRelation: "funil_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fechamentos_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: true
            referencedRelation: "negociacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fechamentos_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      historico_etapas: {
        Row: {
          created_at: string
          etapa_anterior_id: string | null
          etapa_nova_id: string
          id: number
          negociacao_id: string
          usuario_id: string | null
        }
        Insert: {
          created_at?: string
          etapa_anterior_id?: string | null
          etapa_nova_id: string
          id?: never
          negociacao_id: string
          usuario_id?: string | null
        }
        Update: {
          created_at?: string
          etapa_anterior_id?: string | null
          etapa_nova_id?: string
          id?: never
          negociacao_id?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "historico_etapas_etapa_anterior_id_fkey"
            columns: ["etapa_anterior_id"]
            isOneToOne: false
            referencedRelation: "etapas_funil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_etapas_etapa_nova_id_fkey"
            columns: ["etapa_nova_id"]
            isOneToOne: false
            referencedRelation: "etapas_funil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_etapas_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_etapas_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "negociacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_etapas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      metas: {
        Row: {
          created_at: string
          criado_por: string
          id: string
          periodo_mes: string
          updated_at: string
          usuario_id: string | null
          valor_meta: number
        }
        Insert: {
          created_at?: string
          criado_por?: string
          id?: string
          periodo_mes: string
          updated_at?: string
          usuario_id?: string | null
          valor_meta: number
        }
        Update: {
          created_at?: string
          criado_por?: string
          id?: string
          periodo_mes?: string
          updated_at?: string
          usuario_id?: string | null
          valor_meta?: number
        }
        Relationships: [
          {
            foreignKeyName: "metas_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      negociacoes: {
        Row: {
          cliente_id: string
          created_at: string
          data_entrada_etapa: string
          data_primeira_reuniao: string | null
          data_proposta: string | null
          etapa_id: string
          id: string
          motivo_perda: string | null
          objecao_principal: string | null
          owner_id: string
          posicao: number
          temperatura:
            | Database["public"]["Enums"]["temperatura_negociacao"]
            | null
          titulo: string | null
          updated_at: string
          valor_estimado: number | null
        }
        Insert: {
          cliente_id: string
          created_at?: string
          data_entrada_etapa?: string
          data_primeira_reuniao?: string | null
          data_proposta?: string | null
          etapa_id?: string
          id?: string
          motivo_perda?: string | null
          objecao_principal?: string | null
          owner_id: string
          posicao?: number
          temperatura?:
            | Database["public"]["Enums"]["temperatura_negociacao"]
            | null
          titulo?: string | null
          updated_at?: string
          valor_estimado?: number | null
        }
        Update: {
          cliente_id?: string
          created_at?: string
          data_entrada_etapa?: string
          data_primeira_reuniao?: string | null
          data_proposta?: string | null
          etapa_id?: string
          id?: string
          motivo_perda?: string | null
          objecao_principal?: string | null
          owner_id?: string
          posicao?: number
          temperatura?:
            | Database["public"]["Enums"]["temperatura_negociacao"]
            | null
          titulo?: string | null
          updated_at?: string
          valor_estimado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "negociacoes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negociacoes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "negociacoes_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "etapas_funil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negociacoes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          ativo: boolean
          created_at: string
          email: string
          foto_url: string | null
          id: string
          nome: string
          role: Database["public"]["Enums"]["user_role"]
          telefone: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          email: string
          foto_url?: string | null
          id: string
          nome: string
          role?: Database["public"]["Enums"]["user_role"]
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          email?: string
          foto_url?: string | null
          id?: string
          nome?: string
          role?: Database["public"]["Enums"]["user_role"]
          telefone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      proximas_acoes: {
        Row: {
          cliente_id: string
          concluida_em: string | null
          created_at: string
          data: string
          id: string
          negociacao_id: string | null
          observacao: string | null
          titulo: string
          updated_at: string
          usuario_id: string
        }
        Insert: {
          cliente_id: string
          concluida_em?: string | null
          created_at?: string
          data: string
          id?: string
          negociacao_id?: string | null
          observacao?: string | null
          titulo: string
          updated_at?: string
          usuario_id?: string
        }
        Update: {
          cliente_id?: string
          concluida_em?: string | null
          created_at?: string
          data?: string
          id?: string
          negociacao_id?: string | null
          observacao?: string | null
          titulo?: string
          updated_at?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proximas_acoes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proximas_acoes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "proximas_acoes_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proximas_acoes_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "negociacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proximas_acoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      funil_cards: {
        Row: {
          cliente_empresa: string | null
          cliente_id: string | null
          cliente_nome: string | null
          data_entrada_etapa: string | null
          etapa_cor: Database["public"]["Enums"]["cor_etapa"] | null
          etapa_id: string | null
          etapa_nome: string | null
          etapa_tipo: Database["public"]["Enums"]["tipo_etapa"] | null
          id: string | null
          owner_id: string | null
          posicao: number | null
          proxima_acao_data: string | null
          proxima_acao_titulo: string | null
          responsavel_nome: string | null
          temperatura:
            | Database["public"]["Enums"]["temperatura_negociacao"]
            | null
          ultima_atividade_data: string | null
          ultima_atividade_descricao: string | null
          ultima_atividade_tipo:
            | Database["public"]["Enums"]["tipo_atividade"]
            | null
          valor_estimado: number | null
        }
        Relationships: [
          {
            foreignKeyName: "negociacoes_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "etapas_funil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negociacoes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      alterar_status_evento: {
        Args: {
          p_evento_id: string
          p_status: Database["public"]["Enums"]["status_evento"]
        }
        Returns: undefined
      }
      cliente_owner: { Args: { p_cliente_id: string }; Returns: string }
      criar_cliente: {
        Args: {
          p_cargo?: string
          p_cnpj?: string
          p_cpf?: string
          p_email?: string
          p_empresa?: string
          p_nome: string
          p_observacoes?: string
          p_owner_id?: string
          p_responsavel?: string
          p_telefone?: string
          p_tipo_cliente: Database["public"]["Enums"]["tipo_cliente"]
          p_whatsapp?: string
        }
        Returns: string
      }
      dashboard_etapas: {
        Args: { p_fim: string; p_inicio: string }
        Returns: {
          cor: Database["public"]["Enums"]["cor_etapa"]
          etapa_id: string
          nome: string
          ordem: number
          quantidade: number
          tipo: Database["public"]["Enums"]["tipo_etapa"]
          valor: number
        }[]
      }
      dashboard_por_usuario: {
        Args: { p_fim: string; p_inicio: string }
        Returns: {
          abertas: number
          atividades: number
          ganhos: number
          nome: string
          perdidos: number
          pipeline_valor: number
          reunioes_proximas: number
          reunioes_realizadas: number
          role: Database["public"]["Enums"]["user_role"]
          usuario_id: string
          vendido_valor: number
        }[]
      }
      dashboard_vendas_mensais: {
        Args: { p_meses?: number }
        Returns: {
          mes: string
          quantidade: number
          valor: number
        }[]
      }
      etapa_id_por_chave: { Args: { p_chave: string }; Returns: string }
      etapa_tipo: {
        Args: { p_etapa_id: string }
        Returns: Database["public"]["Enums"]["tipo_etapa"]
      }
      etapas_funil_uso: {
        Args: never
        Returns: {
          etapa_id: string
          ja_usada: boolean
          negociacoes_atuais: number
        }[]
      }
      fechar_negociacao: {
        Args: {
          p_contrato_assinado: boolean
          p_contrato_enviado: boolean
          p_data_fechamento: string
          p_link_contrato?: string
          p_negociacao_id: string
          p_posicao: number
          p_status_onboarding: Database["public"]["Enums"]["status_onboarding"]
          p_status_pagamento: Database["public"]["Enums"]["status_pagamento"]
          p_valor_vendido: number
        }
        Returns: undefined
      }
      funil_metricas: {
        Args: { p_fim: string; p_inicio: string }
        Returns: {
          alcancaram: number
          cor: Database["public"]["Enums"]["cor_etapa"]
          etapa_id: string
          nome: string
          ordem: number
          parados_7_dias: number
          parados_medio_segundos: number
          permanencias: number
          quantidade: number
          tempo_medio_segundos: number
          tipo: Database["public"]["Enums"]["tipo_etapa"]
          valor: number
        }[]
      }
      is_gerente: { Args: never; Returns: boolean }
      metas_progresso: {
        Args: { p_mes: string }
        Returns: {
          ativo: boolean
          meta_id: string
          nome: string
          realizado: number
          role: Database["public"]["Enums"]["user_role"]
          usuario_id: string
          valor_meta: number
        }[]
      }
      negociacao_owner: { Args: { p_negociacao_id: string }; Returns: string }
      nomes_de_usuarios: {
        Args: { p_ids: string[] }
        Returns: {
          id: string
          nome: string
        }[]
      }
    }
    Enums: {
      cor_etapa:
        | "azul"
        | "violeta"
        | "amarelo"
        | "laranja"
        | "verde"
        | "vermelho"
        | "ciano"
        | "rosa"
        | "turquesa"
        | "cinza"
      status_evento: "agendado" | "realizado" | "nao_compareceu" | "cancelado"
      status_onboarding: "nao_iniciado" | "em_andamento" | "concluido"
      status_pagamento:
        | "pendente"
        | "parcial"
        | "pago"
        | "atrasado"
        | "cancelado"
      temperatura_negociacao: "quente" | "morno" | "frio"
      tipo_atividade: "nota" | "ligacao" | "email" | "whatsapp" | "reuniao"
      tipo_cliente: "pessoa_fisica" | "empresa"
      tipo_etapa: "aberta" | "ganha" | "perdida"
      tipo_evento: "reuniao" | "ligacao" | "followup" | "apresentacao"
      user_role: "gerente" | "closer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      cor_etapa: [
        "azul",
        "violeta",
        "amarelo",
        "laranja",
        "verde",
        "vermelho",
        "ciano",
        "rosa",
        "turquesa",
        "cinza",
      ],
      status_evento: ["agendado", "realizado", "nao_compareceu", "cancelado"],
      status_onboarding: ["nao_iniciado", "em_andamento", "concluido"],
      status_pagamento: [
        "pendente",
        "parcial",
        "pago",
        "atrasado",
        "cancelado",
      ],
      temperatura_negociacao: ["quente", "morno", "frio"],
      tipo_atividade: ["nota", "ligacao", "email", "whatsapp", "reuniao"],
      tipo_cliente: ["pessoa_fisica", "empresa"],
      tipo_etapa: ["aberta", "ganha", "perdida"],
      tipo_evento: ["reuniao", "ligacao", "followup", "apresentacao"],
      user_role: ["gerente", "closer"],
    },
  },
} as const
