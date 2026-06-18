export type ImageDetail = "auto" | "low" | "high" | "original";

export interface ByteRange {
  start: number;
  end: number;
}

export interface TextElement {
  byteRange: ByteRange;
  placeholder: string | null;
}

export type UserInput =
  | {
      type: "text";
      text: string;
      text_elements?: TextElement[];
    }
  | {
      type: "image";
      detail?: ImageDetail;
      url: string;
    }
  | {
      type: "localImage";
      detail?: ImageDetail;
      path: string;
    }
  | {
      type: "skill";
      name: string;
      path: string;
    }
  | {
      type: "mention";
      name: string;
      path: string;
    };
