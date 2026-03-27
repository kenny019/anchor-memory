/**
 * Budget-based message formatting for LLM prompts.
 * Distributes a total char budget proportionally across messages
 * instead of hardcoding per-message truncation.
 */
export function formatMessagesForLLM(messages, { totalBudget = 3000, maxMessages = 15 } = {}) {
    if (!Array.isArray(messages) || messages.length === 0) return '';

    const recent = messages.slice(-maxMessages);
    const lines = recent.map(m => {
        const name = m.name || (m.isUser ? 'User' : 'Character');
        return `${name}: ${String(m.text || '')}`;
    });

    const joinOverhead = lines.length - 1;
    const totalRaw = lines.reduce((sum, l) => sum + l.length, 0);
    if (totalRaw + joinOverhead <= totalBudget) return lines.join('\n');

    const charBudget = totalBudget - joinOverhead;
    const minPerMsg = Math.min(80, Math.floor(charBudget / lines.length));

    // Iterative allocation: lock in messages that fit at natural size or need min floor,
    // then redistribute remainder among unfixed messages
    const allocs = new Array(lines.length).fill(0);
    const fixed = new Array(lines.length).fill(false);
    let remaining = charBudget;
    let unfixedRaw = totalRaw;

    for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < lines.length; i++) {
            if (fixed[i]) continue;
            const proportional = unfixedRaw > 0
                ? Math.floor((lines[i].length / unfixedRaw) * remaining)
                : minPerMsg;
            const share = Math.max(minPerMsg, proportional);

            // Message fits entirely within share
            if (lines[i].length <= share) {
                allocs[i] = lines[i].length;
                fixed[i] = true;
                remaining -= lines[i].length;
                unfixedRaw -= lines[i].length;
            } else if (share <= minPerMsg) {
                // Bumped to floor — lock it
                allocs[i] = minPerMsg;
                fixed[i] = true;
                remaining -= minPerMsg;
                unfixedRaw -= lines[i].length;
            } else {
                allocs[i] = share;
            }
        }
    }

    // Final pass: assign remaining budget to any still-unfixed messages
    for (let i = 0; i < lines.length; i++) {
        if (fixed[i]) continue;
        const share = unfixedRaw > 0
            ? Math.floor((lines[i].length / unfixedRaw) * remaining)
            : minPerMsg;
        allocs[i] = Math.max(minPerMsg, share);
    }

    const truncated = lines.map((line, i) => {
        if (line.length <= allocs[i]) return line;
        return `${line.slice(0, allocs[i] - 3)}...`;
    });

    return truncated.join('\n');
}
