export interface TextCopier {
  // コピーできたら true。container は押したボタンのある場所（開いているモーダルの dialog の中など）
  copy(text: string, container: Element): Promise<boolean>
}

// クリップボードに文字を入れる（screens.md §3 の「AI に相談」）。
// navigator.clipboard は安全なコンテキスト（https・localhost）でしか使えない。スマホから dev:lan の http で開いたときにも
// コピーできるよう、使えなければ隠した textarea を選んで execCommand('copy') する（古い方法だが、ほかに手段がない）
export class Clipboard implements TextCopier {
  async copy(text: string, container: Element): Promise<boolean> {
    const { clipboard } = navigator
    // 安全なコンテキストでなければ、navigator.clipboard そのものがない
    if (window.isSecureContext && clipboard !== undefined) {
      await clipboard.writeText(text)
      return true
    }
    return this.#copyBySelection(text, container)
  }

  // textarea は container の中に置く。モーダルの dialog が開いている間は、その外の要素は操作できず（inert）選べない
  #copyBySelection(text: string, container: Element): boolean {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    const { style } = area
    style.position = 'fixed'
    style.opacity = '0'
    container.append(area)
    area.focus()
    area.select()
    // iPhone の Safari は readonly の textarea を select() だけでは選ばない
    area.setSelectionRange(0, text.length)
    const copied = document.execCommand('copy')
    area.remove()
    return copied
  }
}
