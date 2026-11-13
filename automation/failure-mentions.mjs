// Resolve IDs with the sending app's token: open_id is app-scoped.
export const FAILURE_MENTION_TARGETS = Object.freeze([
  { name: '段志伟', aliases: ['段志伟'] },
  { name: '吴奇波', aliases: ['吴奇波'] },
  { name: '王亚珍', aliases: ['王亚珍'] },
  { name: '三酱', aliases: ['三酱', '邓雄飞'] },
  { name: '国庆', aliases: ['国庆', '李国庆'] },
  { name: '柯男', aliases: ['柯男', '陈柯男'] },
  { name: '余快', aliases: ['余快'] },
]);

export function resolveFailureMentions(members) {
  const ids = new Set();
  return FAILURE_MENTION_TARGETS.map(target => {
    const matches = members.filter(member => target.aliases.includes(member.name?.trim()));
    if (matches.length !== 1 || !/^ou_[a-zA-Z0-9]+$/.test(matches[0]?.member_id ?? '') || ids.has(matches[0].member_id)) {
      throw new Error(`失败提醒名单无法唯一核实：${target.name}；不发送任何定向@，不回退@所有人`);
    }
    ids.add(matches[0].member_id);
    return `<at user_id="${matches[0].member_id}">${target.name}</at>`;
  }).join(' ');
}

export async function failureMentionText(config, failed, env, readApi) {
  if (!failed || config.receiveIdType !== 'chat_id' || env.FEISHU_PRIVATE_REPORT === 'true'
    || env.FEISHU_FAILURE_MENTIONS_ENABLED === 'false' || env.FEISHU_MENTION_ALL_ON_FAILURE === 'false') return '';
  const root = `/open-apis/im/v1/chats/${encodeURIComponent(config.receiveId)}`;
  const chat = await readApi(root);
  if (!['group', 'topic'].includes(chat.data?.chat_mode)) return '';
  const members = [], seen = new Set();
  let cursor = '';
  do {
    const query = new URLSearchParams({ member_id_type: 'open_id', page_size: '100' });
    if (cursor) query.set('page_token', cursor);
    const response = await readApi(`${root}/members?${query}`);
    if (!Array.isArray(response.data?.items)) throw new Error('群成员读取不完整，跳过定向@');
    members.push(...response.data.items);
    cursor = response.data.has_more ? response.data.page_token : '';
    if (response.data.has_more && (!cursor || seen.has(cursor))) throw new Error('群成员分页异常，跳过定向@');
    if (cursor) seen.add(cursor);
    if (seen.size > 100) throw new Error('群成员分页超出上限，跳过定向@');
  } while (cursor);
  return `${resolveFailureMentions(members)}\nJuJuBit UI 自动化复核后仍未通过，请查看下方结果卡片。`;
}
