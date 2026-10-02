export interface RetrievalToolsConfig {
  /** Cap on the text one `search_code` call returns to the model. Default 12000 characters. */
  maxOutputChars?: number
  /** Results returned when the model gives no `k`. Default 8. */
  defaultK?: number
  /** Largest `k` the model may ask for. Default 20. */
  maxK?: number
  /** Paths `list_code_files` returns at most. Default 200. */
  maxListFiles?: number
}

/** Programmer error (bad config), not a tool outcome. */
export class RetrievalToolsConfigError extends Error {
  override name = 'RetrievalToolsConfigError'
}
