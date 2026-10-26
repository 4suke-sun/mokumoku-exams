// データの契約は共有パッケージから読む。アプリの内部は import しない。

export { checkAnswerBias } from "@mokumoku-exams/data-schema/exam-data/bias";
export {
  HEADING_KINDS,
  headingKind,
  normalizeHeading,
  unpairedWrongParagraphs,
} from "@mokumoku-exams/data-schema/exam-data/explanation";
export {
  ALLOWED_REFERENCE_HOSTS,
  ChoiceQuestionSchema,
  CRITERION_NAME_MAX,
  containsUrl,
  EXAM_CODE,
  ExamsFileSchema,
  FreeTextQuestionSchema,
  hostAllowedForVendor,
  KEYWORD_MAX,
  normalizeKeyword,
  normalizeText,
  QUESTION_ID,
  QuestionsFileSchema,
  REFERENCE_HOST_VENDORS,
  REFERENCE_TITLE_MAX,
  ReferenceTitle,
  RubricSchema,
  type SourceUrlReason,
  sourceUrlReason,
} from "@mokumoku-exams/data-schema/exam-data/schema";
export { validateDataSet } from "@mokumoku-exams/data-schema/exam-data/validate";
