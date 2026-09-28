const { SCHEMA_VERSION, makeEventId, safeString, validateNormalizedEvent } = require('./event-schema.cjs');
const { giftId: normalizeGiftId } = require('../gifts/gift-registry.cjs');

function finiteGiftCoins(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const number = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
    if (Number.isSafeInteger(number) && number >= 0) return number;
  }
  return null;
}
function giftImage(...values) {
  for (const value of values) {
    const candidate = typeof value === 'string' ? value : value?.url || value?.url_list?.[0] || value?.urlList?.[0];
    try { const url = new URL(candidate); if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href; } catch {}
  }
  return '';
}

function normalizePlatform(value) {
  const p = safeString(value || 'internal').toLowerCase();
  if (p.includes('tiktok')) return 'tiktok';
  if (p.includes('twitch')) return 'twitch';
  if (p.includes('youtube')) return 'youtube';
  if (p.includes('cng')) return 'cng';
  return 'internal';
}

function normalizeType(value, fallback = 'custom') {
  const t = safeString(value || fallback).toLowerCase();
  if (t === 'comment' || t === 'message') return 'chat';
  if (t === 'subscribe' || t === 'subscription') return 'sub';
  if (['chat', 'gift', 'join', 'follow', 'like', 'sub', 'moderation', 'system', 'command', 'custom', 'share', 'raid', 'stream_start', 'stream_end', 'cheer', 'resub', 'giftsub', 'giftbomb', 'tip'].includes(t)) return t;
  return fallback;
}

function normalizeUser(input = {}) {
  const nested = input.user && typeof input.user === 'object';
  const user = nested ? input.user : input;
  const username = safeString(user.username || user.uniqueId || user.login || user.name || user.author || input.username || 'unknown');
  const displayName = safeString(user.displayName || user.nickname || user.authorName || input.displayName || username);
  return {
    id: safeString((nested ? user.id : '') || user.userId || user.user_id || user.userIdString || input.userId || username),
    identityVerified:user.identityVerified===true||input.identityVerified===true,
    username,
    displayName,
    avatar: safeString(user.avatar || user.avatarUrl || user.profilePictureUrl || ''),
    badges: Array.isArray(user.badges) ? user.badges : Array.isArray(input.badges) ? input.badges : [],
    isModerator: [user.isModerator,user.moderator,user.mod,input.isModerator,input.moderator,input.mod].some(x=>x===true),
    isBroadcaster: user.isBroadcaster===true||input.isBroadcaster===true
  };
}

function normalizeChat(input = {}, sourceConnector = 'unknown') {
  const platform = normalizePlatform(input.platform || input.source || sourceConnector);
  const text = safeString(input.message?.text || input.message || input.text || input.comment || input.msg || '').trim();
  const timestamp = input.timestamp && !Number.isNaN(Date.parse(input.timestamp)) ? new Date(input.timestamp).toISOString() : new Date().toISOString();
  const user = normalizeUser(input);
  const sourceId = input.id || input.eventId || input.messageId;
  const event = {
    schemaVersion: SCHEMA_VERSION,
    eventId: makeEventId(platform, 'chat', sourceId, `${timestamp}|${user.id}|${text}`),
    platform,
    channelId:safeString(input.channelId||input.roomId||input.room_id||input.raw?.snippet?.liveChatId||input.raw?.data?.roomId||''),
    type: 'chat',
    timestamp,
    user,
    message: { text, emotes: Array.isArray(input.emotes) ? input.emotes : [], reply: input.reply || null },
    gift: null,
    moderation: null,
    meta: {
      sourceConnector,
      receivedAt: new Date().toISOString(),
      rawData: input.raw || input
    }
  };
  const validation = validateNormalizedEvent(event);
  if (!validation.ok) throw new Error(`Event-Validierung fehlgeschlagen: ${validation.errors.join(' ')}`);
  return event;
}

function normalizeEvent(input = {}, sourceConnector = 'unknown') {
  if (input.schemaVersion === SCHEMA_VERSION && input.eventId && input.meta) {
    const validation = validateNormalizedEvent(input);
    if (!validation.ok) throw new Error(`Event-Validierung fehlgeschlagen: ${validation.errors.join(' ')}`);
    return input;
  }

  const platform = normalizePlatform(input.platform || input.source || sourceConnector);
  const type = normalizeType(input.type || input.event, 'custom');
  if (type === 'chat') return normalizeChat(input.data && typeof input.data === 'object' ? { ...input.data, platform } : input, sourceConnector);

  const data = input.data && typeof input.data === 'object' ? input.data : input;
  const timestamp = input.timestamp && !Number.isNaN(Date.parse(input.timestamp)) ? new Date(input.timestamp).toISOString() : new Date().toISOString();
  const user = normalizeUser(data);
  const sourceId = input.id || input.eventId || data.id || data.eventId || data.msgId;
  const gift = type === 'gift' ? {
    // Message/event IDs identify an occurrence, never a gift product.
    id: normalizeGiftId(data.giftId ?? data.gift_id ?? data.gift?.id ?? data.gift?.giftId ?? data.giftDetails?.id ?? data.giftDetails?.giftId ?? data.gift_details?.id),
    name: safeString(data.giftName || data.gift?.name || data.giftDetails?.name || data.gift_details?.name || ''),
    count: Math.max(1, Number(data.count || data.repeatCount || data.gift?.count || 1)),
    value: Number.isFinite(Number(data.value ?? data.coins ?? data.diamondCount)) ? Number(data.value ?? data.coins ?? data.diamondCount) : null,
    currency: safeString(data.currency || '') || null,
    coins: finiteGiftCoins(data.coinsPerGift, data.diamondCount, data.diamond_count, data.coins, data.gift?.diamondCount, data.gift?.diamond_count, data.gift?.coins, data.giftDetails?.diamondCount, data.giftDetails?.diamond_count, data.gift_details?.diamond_count),
    imageUrl: giftImage(data.giftPictureUrl, data.giftImageUrl, data.gift?.imageUrl, data.gift?.image, data.giftDetails?.imageUrl, data.giftDetails?.image, data.gift_details?.image)
  } : null;
  const moderation = type === 'moderation' ? {
    action: safeString(data.action || ''),
    target: data.target || null,
    moderator: data.moderator || null,
    reason: safeString(data.reason || ''),
    duration: Number.isFinite(Number(data.duration)) ? Number(data.duration) : null
  } : null;
  const seed = `${timestamp}|${user.id}|${type}|${JSON.stringify(gift || moderation || data.text || '')}`;
  const event = {
    schemaVersion: SCHEMA_VERSION,
    eventId: makeEventId(platform, type, sourceId, seed),
    platform,
    type,
    channelId:safeString(input.channelId||data.channelId||data.roomId||data.room_id||''),
    timestamp,
    user,
    message: data.message || data.text || data.comment ? { text: safeString(data.message?.text || data.message || data.text || data.comment), emotes: [], reply: null } : null,
    gift,
    moderation,
    data: {parameters:type==='custom'?data.parameters||{}:undefined,channel:data.channel||null,subTier:data.subTier||null,unit:data.unit||null,currency:data.currency||null,provider:data.provider||null,skipAggregation:data.skipAggregation===true,count:data.count ?? data.repeatCount ?? null,value:data.value ?? data.amount ?? null,text:data.text ?? null},
    meta: {
      sourceConnector,
      receivedAt: new Date().toISOString(),
      rawData: input.raw || input
    }
  };
  const validation = validateNormalizedEvent(event);
  if (!validation.ok) throw new Error(`Event-Validierung fehlgeschlagen: ${validation.errors.join(' ')}`);
  return event;
}

module.exports = { normalizePlatform, normalizeType, normalizeUser, normalizeChat, normalizeEvent };
