export interface AddedLine { file: string; line: number; text: string }
export interface CheckResult { blocks: string[]; warns: string[] }
export function parseAddedLines(diffText: string): AddedLine[];
export function textToEntries(text: string, label: string): AddedLine[];
export function checkSensitiveFilenames(files: string[]): string[];
export function checkUnexpectedPaths(files: string[]): string[];
export function checkEntries(entries: AddedLine[], denylistTerms?: string[], options?: { message?: boolean }): CheckResult;
export function checkAuthors(entries: { sha: string; email: string }[]): string[];
export function parseDenylist(text: string): string[];
