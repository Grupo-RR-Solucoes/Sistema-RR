export type UserRole =
  | "socio"
  | "funcionario"
  | "promotor"
  | "supervisor"
  | "gerente_regional";

export interface AppUserWithRole {
  id: string;
  email: string;
  fullName: string | null;
  role: UserRole;
  cnpjId: string | null;
  promoterId: string | null;
  active: boolean;
}

export interface AuthSession {
  authUserId: string;
  email: string;
  appUser: AppUserWithRole;
}
