import fs from 'fs';
import path from 'path';
import Logger from './Logger';

// エイリアス辞書を JSON で保持
// 例: { "インスタ": "Instagram", "インスタグラム": "Instagram" }

class AliasNormalizer {
  private static aliasMap: Record<string, string> = {};
  private static logger = new Logger('AliasNormalizer');

  private static loadAliasMap(): Record<string, string> {
    if (Object.keys(AliasNormalizer.aliasMap).length > 0) {
      return AliasNormalizer.aliasMap;
    }

    // dist 実行 / ts-node / テスト など環境差を吸収する候補パス
    const candidatePaths = [
      path.resolve(__dirname, '../data/alias.json'),                     // dist/utils -> dist/data
      path.resolve(__dirname, '../../src/data/alias.json'),             // dist/utils -> projectRoot/src/data
      path.resolve(process.cwd(), 'src/data/alias.json'),              // プロジェクトルート想定
    ];

    for (const p of candidatePaths) {
      try {
        if (fs.existsSync(p)) {
          const json = fs.readFileSync(p, 'utf-8');
          AliasNormalizer.aliasMap = JSON.parse(json);
          AliasNormalizer.logger.info('エイリアスマップを読み込みました', {
            path: p,
            count: Object.keys(AliasNormalizer.aliasMap).length,
          });
          return AliasNormalizer.aliasMap;
        }
      } catch (err) {
        // 読み込み失敗時は debug レベルでスキップ
        AliasNormalizer.logger.debug('エイリアス候補パスの読み込み失敗', { path: p, error: err });
      }
    }

    // すべて失敗
    AliasNormalizer.logger.error('エイリアスマップの読み込みに失敗しました。空マップで続行します');
    AliasNormalizer.aliasMap = {};
    return AliasNormalizer.aliasMap;
  }


  /**
   * 単一キーワードを正規化
   */
  static normalize(word: string): string {
    const map = AliasNormalizer.loadAliasMap();
    return map[word] ?? word;
  }

  /**
   * キーワード配列を正規化（重複も排除）
   */
  static normalizeList(words: string[]): string[] {
    const map = AliasNormalizer.loadAliasMap();
    const normalized = words.map(w => map[w] ?? w);
    // 重複を排除し順序を保持
    return [...new Set(normalized)];
  }
}

export default AliasNormalizer;
