// 紙吹雪の粒 1 つ。x・y は出る位置（中央）から飛んでいく先までの距離（px）
export type ConfettiPiece = { x: number; y: number; rotate: number; delay: number; kind: number }

export interface ConfettiLayout {
  pieces(count: number): ConfettiPiece[]
}

const KINDS = 4
// 飛ぶ距離は 2 通りを交互にし、輪にならずに散って見えるようにする
const DISTANCES = [120, 170]
// 最後に少し落ちる
const FALL = 40

// 🎉 の労いの演出（screens.md §4）の紙吹雪。乱数を使わずに、粒を放射状に均等に散らす
// （毎回同じ形になるが、動きは 1 秒ほどなので気にならない。テストで位置を確かめられる）
export class ConfettiBurst implements ConfettiLayout {
  pieces(count: number): ConfettiPiece[] {
    return Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2 - Math.PI / 2
      const distance = DISTANCES[index % DISTANCES.length] ?? 0
      return {
        x: Math.round(Math.cos(angle) * distance),
        y: Math.round(Math.sin(angle) * distance + FALL),
        rotate: (index % 2 === 0 ? 1 : -1) * (90 + index * 15),
        delay: (index % 3) * 0.04,
        kind: index % KINDS,
      }
    })
  }
}
