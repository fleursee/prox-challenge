export type Role = "user" | "assistant";

export interface TextMessage {
  type: "text";
  role: Role;
  content: string;
}

export interface ArtifactMessage {
  type: "artifact";
  role: "assistant";
  artifactType: "html" | "svg";
  code: string;
}

export interface ImageMessage {
  type: "image";
  role: "assistant";
  source: string;
  page: number;
  b64: string;
}

export type Message = TextMessage | ArtifactMessage | ImageMessage;

export interface StreamEvent {
  event: "text" | "artifact" | "image" | "done" | "error";
  data: Record<string, unknown>;
}