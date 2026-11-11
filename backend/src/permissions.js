// Regras de permissão — fonte única usada pelas rotas, pelo chat e pelo painel.
// Funções puras: recebem { id, role, is_original_owner } e não acessam o banco.
export const ROLES = ['OWNER', 'ADMIN', 'MOD', 'PLAYER'];

const same = (a, b) => a && b && String(a.id) === String(b.id);

export const hasInfiniteCoins = (u) => !!u && (u.role === 'OWNER' || u.role === 'MOD');
export const isStaff = (u) => !!u && ['OWNER', 'ADMIN', 'MOD'].includes(u.role);
export const canViewReports = (u) => !!u && (u.role === 'OWNER' || u.role === 'MOD');
export const canManageCodes = (u) => !!u && u.role === 'OWNER';
export const canViewAudit = (u) => !!u && u.role === 'OWNER';
export const canViewInfluencers = (u) => !!u && u.role === 'OWNER';

export function canKick(actor, target) {
  if (!actor || !target || same(actor, target) || target.is_original_owner) return false;
  if (actor.role === 'OWNER') return true;
  if (actor.role === 'MOD' || actor.role === 'ADMIN') return target.role === 'PLAYER';
  return false;
}

export function canBan(actor, target) {
  if (!actor || !target || same(actor, target) || target.is_original_owner) return false;
  if (actor.role === 'OWNER') return true;
  if (actor.role === 'MOD') return target.role === 'PLAYER';
  return false; // ADMIN e PLAYER não banem
}
export const canUnban = canBan;
export const canMute = canBan;

export function canSetRole(actor, target, newRole) {
  if (!actor || !target || !ROLES.includes(newRole)) return false;
  if (same(actor, target) || target.is_original_owner || target.role === newRole) return false;
  if (actor.role === 'OWNER') {
    // Criar ou rebaixar outro OWNER é exclusivo do OWNER original.
    if (newRole === 'OWNER' || target.role === 'OWNER') return !!actor.is_original_owner;
    return true;
  }
  if (actor.role === 'MOD') {
    return (target.role === 'PLAYER' && newRole === 'MOD') || (target.role === 'MOD' && newRole === 'PLAYER');
  }
  return false;
}

export function canManageInfluencer(actor, target) {
  if (!actor || !target || actor.role !== 'OWNER') return false;
  if (target.is_original_owner && !same(actor, target)) return false;
  return true;
}

export function canDeleteChatMessage(actor, author) {
  if (!actor || !author) return false;
  if (same(actor, author)) return true;
  return canBan(actor, author);
}

export function allowedActions(actor, target) {
  return {
    kick: canKick(actor, target),
    ban: canBan(actor, target),
    unban: canUnban(actor, target),
    mute: canMute(actor, target),
    roles: ROLES.filter((r) => canSetRole(actor, target, r)),
    influencer: canManageInfluencer(actor, target),
  };
}
