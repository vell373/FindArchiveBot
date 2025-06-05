/**
 * 検索クエリのインターフェース
 * ユーザーからの入力を表現
 */
export interface SearchQuery {
  queryText: string;      // ユーザーが入力したテキスト
  categories: string[];   // 選択されたカテゴリ
  tools: string[];        // 選択されたツール
  keywords?: string[];    // 抽出されたキーワード
}

/**
 * モーダル入力から検索クエリを生成
 */
export function createSearchQueryFromModal(
  queryText: string,
  categories: string[],
  tools: string[]
): SearchQuery {
  return {
    queryText,
    categories,
    tools
  };
}
