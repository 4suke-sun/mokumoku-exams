// データの契約は共有パッケージから読む。アプリの内部は import しない。
export {
  ALLOWED_REFERENCE_HOSTS,
  ChoiceQuestionSchema,
  containsUrl,
  EXAM_CODE,
  ExamsFileSchema,
  FreeTextQuestionSchema,
  hostAllowedForVendor,
  normalizeKeyword,
  normalizeText,
  QUESTION_ID,
  QuestionsFileSchema,
  REFERENCE_HOST_VENDORS,
  RubricSchema,
  type SourceUrlReason,
  sourceUrlReason,
} from "@mokumoku-exams/data-schema/exam-data/schema";
export { validateDataSet } from "@mokumoku-exams/data-schema/exam-data/validate";
