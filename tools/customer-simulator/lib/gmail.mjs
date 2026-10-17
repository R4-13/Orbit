// Die wenigen Gmail-Aufrufe, die der Simulator braucht (Quelle: https://developers.google.com/workspace/gmail/api/reference/rest). Alles im Postfach von „Tom“.
const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export function createGmail({ getToken, fetchImpl = fetch }) {
  async function call(method, path, body) {
    const response = await fetchImpl(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await getToken()}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(`Gmail ${method} ${path.split('?')[0]} → ${response.status}${detail.error?.message ? `: ${detail.error.message}` : ''}`);
    }
    return response.status === 204 ? undefined : response.json();
  }

  return {
    /** Wem gehört das Konto, für das der Zugang gilt? */
    profile: () => call('GET', '/profile'),
    /**
     * @param {string} raw die Nachricht als URL-sicheres Base64
     * @param {string} [threadId] Gmail-Faden, in den die Nachricht gehört (für Antworten)
     */
    send: (raw, threadId) => call('POST', '/messages/send', { raw, ...(threadId ? { threadId } : {}) }),
    async ensureLabel(name) {
      const existing = (await call('GET', '/labels')).labels?.find((label) => label.name === name);
      if (existing) return existing.id;
      return (await call('POST', '/labels', { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' })).id;
    },
    addLabel: (messageId, labelId) => call('POST', `/messages/${encodeURIComponent(messageId)}/modify`, { addLabelIds: [labelId] }),
    /** Alle Nachrichten mit diesem Etikett (höchstens `limit`). */
    async listByLabel(labelId, limit = 500) {
      const ids = [];
      let pageToken;
      do {
        const page = await call('GET', `/messages?labelIds=${encodeURIComponent(labelId)}&maxResults=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
        ids.push(...(page.messages ?? []).map((m) => m.id));
        pageToken = page.nextPageToken;
      } while (pageToken && ids.length < limit);
      return ids.slice(0, limit);
    },
    /** Die neuesten Nachrichten im Posteingang (nur Absender, Betreff, Datum und Anfang – nichts wird verändert). */
    async recentInbox(limit = 10) {
      const page = await call('GET', `/messages?labelIds=INBOX&maxResults=${Math.min(Math.max(limit, 1), 50)}`);
      const rows = [];
      for (const { id } of page.messages ?? []) {
        const message = await call('GET', `/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID&metadataHeaders=References`);
        const header = (name) => message.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? '';
        rows.push({ id, threadId: message.threadId ?? '', messageId: header('message-id'), references: header('references'), from: header('from'), subject: header('subject'), date: header('date'), snippet: message.snippet ?? '' });
      }
      return rows;
    },
    trash: (messageId) => call('POST', `/messages/${encodeURIComponent(messageId)}/trash`),
  };
}
