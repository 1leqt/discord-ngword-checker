// ==UserScript==
// @name         Discord NGWORD CHECKER
// @namespace    https://example.com/
// @version      1.0.0
// @description  Discordでメッセージ送信前に登録したNGワードと照合し、該当時は確認ダイアログを表示する
// @author       you
// @match        https://discord.com/*
// @match        https://ptb.discord.com/*
// @match        https://canary.discord.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'ngWordList_v1';

  // ---------------------------------------------------------
  // NGワードリストの読み書き
  // ---------------------------------------------------------
  function getWordList() {
    const raw = GM_getValue(STORAGE_KEY, '');
    return raw
      .split('\n')
      .map((w) => w.trim())
      .filter((w) => w.length > 0);
  }

  function saveWordList(words) {
    GM_setValue(STORAGE_KEY, words.join('\n'));
  }

  // ---------------------------------------------------------
  // 設定パネル（テキスト直接編集 or .txtファイル読み込み）
  // ---------------------------------------------------------
  function openSettingsPanel() {
    if (document.getElementById('ngword-settings-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'ngword-settings-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      z-index: 999999; display: flex; align-items: center; justify-content: center;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
      background: #2b2d31; color: #fff; padding: 20px; border-radius: 8px;
      width: 480px; max-width: 90vw; font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    `;

    box.innerHTML = `
      <h2 style="margin:0 0 8px;">NGワード設定</h2>
      <p style="font-size:13px; color:#b5bac1; margin:0 0 10px;">
        1行に1つずつ、NGワード（部分一致文字列）を入力してください。<br>
        大文字・小文字は区別しません。
      </p>
      <textarea id="ngword-textarea" spellcheck="false" style="
        width:100%; height:200px; background:#1e1f22; color:#fff;
        border:1px solid #444; border-radius:4px; padding:8px; box-sizing:border-box;
        font-family: monospace; resize: vertical;"></textarea>
      <div style="margin-top:10px; font-size:13px; color:#b5bac1;">
        .txtファイルから読み込む（内容がテキストエリアに反映されます）:
        <br>
        <input type="file" id="ngword-file-input" accept=".txt" style="color:#fff; margin-top:4px;">
      </div>
      <div style="margin-top:16px; text-align:right;">
        <button id="ngword-cancel" style="margin-right:8px; padding:6px 14px; border:none; border-radius:4px; cursor:pointer; background:#4e5058; color:#fff;">キャンセル</button>
        <button id="ngword-save" style="padding:6px 14px; border:none; border-radius:4px; background:#5865f2; color:#fff; cursor:pointer;">保存</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const textarea = box.querySelector('#ngword-textarea');
    textarea.value = getWordList().join('\n');

    box.querySelector('#ngword-file-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        textarea.value = reader.result;
      };
      reader.readAsText(file, 'utf-8');
    });

    box.querySelector('#ngword-cancel').addEventListener('click', () => overlay.remove());
    box.querySelector('#ngword-save').addEventListener('click', () => {
      const words = textarea.value
        .split('\n')
        .map((w) => w.trim())
        .filter(Boolean);
      saveWordList(words);
      overlay.remove();
      alert(`NGワードを${words.length}件保存しました。`);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  GM_registerMenuCommand('NGワード設定を開く', openSettingsPanel);

  // ---------------------------------------------------------
  // メッセージ本文とNGワードの照合
  // ---------------------------------------------------------
  function findMatches(text) {
    const words = getWordList();
    if (words.length === 0) return [];
    const lowerText = text.toLowerCase();
    return words.filter((w) => lowerText.includes(w.toLowerCase()));
  }

  function getEditorText(editor) {
    // Discordのメッセージ入力欄はSlate.jsベースのcontenteditable div
    return editor.innerText || '';
  }

  // ---------------------------------------------------------
  // Enter送信のフック
  // ---------------------------------------------------------
  function attachListener(editor) {
    if (editor.dataset.ngwordAttached) return;
    editor.dataset.ngwordAttached = 'true';

    let bypassOnce = false;

    editor.addEventListener(
      'keydown',
      function (e) {
        // Shift+Enter（改行）やIME変換確定中のEnterは対象外
        if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;

        // 確認後にこちらから再送したEnterイベントはチェックをスキップ
        if (bypassOnce) {
          bypassOnce = false;
          return;
        }

        const text = getEditorText(editor);
        if (!text.trim()) return;

        const matches = findMatches(text);
        if (matches.length === 0) return;

        // NGワード該当：いったん送信をブロックして確認
        e.preventDefault();
        e.stopImmediatePropagation();

        const uniqueMatches = [...new Set(matches)];
        const ok = window.confirm(
          `⚠ 以下のNGワードに一致しました:\n\n${uniqueMatches.join(', ')}\n\n本当に送信しますか？`
        );

        if (ok) {
          bypassOnce = true;
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
          });
          editor.dispatchEvent(enterEvent);
        }
      },
      true // キャプチャフェーズでDiscord本体より先に処理する
    );
  }

  // ---------------------------------------------------------
  // Discordの入力欄はSPAのため、画面遷移のたびに再生成される。
  // MutationObserverで常に監視し、見つけ次第フックする。
  // ---------------------------------------------------------
  const EDITOR_SELECTOR = 'div[role="textbox"][data-slate-editor="true"]';

  function scanForEditors() {
    document.querySelectorAll(EDITOR_SELECTOR).forEach(attachListener);
  }

  const observer = new MutationObserver(() => {
    scanForEditors();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // 初回スキャン
  scanForEditors();
})();
