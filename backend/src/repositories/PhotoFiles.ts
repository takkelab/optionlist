// 写真のファイルの置き場所（api.md §5）。手元と CI は LocalPhotoFiles、確認用と本番は GcsPhotoFiles
// 名前はサーバーで決める（パストラバーサル対策）。保存するのは sharp で作り直した JPEG だけ（docs/decisions/0037）
export interface PhotoFiles {
  // サーバーで決めた名前（<UUID>.jpg）で保存し、その名前を返す
  save(bytes: Buffer): Promise<string>;
  // なければ null
  read(filename: string): Promise<Buffer | null>;
  // すでにないファイルは失敗にしない
  remove(filename: string): Promise<void>;
}
