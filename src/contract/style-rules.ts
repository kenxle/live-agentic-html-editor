/*
 * read-when: Changing what counts as a valid style id, palette colour or style name.
 */

declare const styleIdBrand: unique symbol;
declare const hexColourBrand: unique symbol;
declare const styleNameBrand: unique symbol;

export type StyleId = string & { readonly [styleIdBrand]: true };
export type HexColour = string & { readonly [hexColourBrand]: true };
export type StyleName = string & { readonly [styleNameBrand]: true };

export const ID_PATTERN: RegExp = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const RESERVED_ID = "international";
export const RESERVED_NAME = "International Style";
export const NAME_MAX = 40;
export const DESCRIPTION_MAX = 300;
export const PALETTE_MAX = 6;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const NAME_CHARS = /^[\p{L}\p{N} '&-]+$/u;

export function isStyleId(value: unknown): value is StyleId {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function isHexColour(value: unknown): value is HexColour {
  return typeof value === "string" && HEX.test(value);
}

export function isStyleName(value: unknown): value is StyleName {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= NAME_MAX &&
    value === value.trim() &&
    NAME_CHARS.test(value)
  );
}
