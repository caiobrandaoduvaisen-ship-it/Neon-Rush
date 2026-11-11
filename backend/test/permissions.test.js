import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canKick, canBan, canSetRole, canManageInfluencer, hasInfiniteCoins, allowedActions } from '../src/permissions.js';

const U = (id, role, extra = {}) => ({ id, role, is_original_owner: false, ...extra });
const original = U(1, 'OWNER', { is_original_owner: true });
const owner2 = U(2, 'OWNER');
const admin = U(3, 'ADMIN');
const mod = U(4, 'MOD');
const mod2 = U(5, 'MOD');
const player = U(6, 'PLAYER');

test('OWNER original não pode ser expulso, banido ou rebaixado por ninguém', () => {
  for (const a of [owner2, admin, mod, player]) {
    assert.equal(canKick(a, original), false);
    assert.equal(canBan(a, original), false);
    for (const r of ['ADMIN', 'MOD', 'PLAYER']) assert.equal(canSetRole(a, original, r), false);
    assert.equal(canManageInfluencer(a, original), false);
  }
});

test('KICK: OWNER todos (menos o original); MOD e ADMIN só PLAYER; PLAYER ninguém', () => {
  assert.equal(canKick(owner2, admin), true);
  assert.equal(canKick(owner2, mod), true);
  assert.equal(canKick(mod, player), true);
  assert.equal(canKick(admin, player), true);
  assert.equal(canKick(mod, mod2), false);
  assert.equal(canKick(admin, mod), false);
  assert.equal(canKick(player, U(9, 'PLAYER')), false);
});

test('BAN: ADMIN e PLAYER não banem; MOD só PLAYER', () => {
  assert.equal(canBan(admin, player), false);
  assert.equal(canBan(player, U(9, 'PLAYER')), false);
  assert.equal(canBan(mod, player), true);
  assert.equal(canBan(mod, admin), false);
  assert.equal(canBan(owner2, mod), true);
});

test('Cargos: MOD só PLAYER↔MOD, nunca o próprio; ADMIN não muda cargos', () => {
  assert.equal(canSetRole(mod, player, 'MOD'), true);
  assert.equal(canSetRole(mod, mod2, 'PLAYER'), true);
  assert.equal(canSetRole(mod, player, 'ADMIN'), false);
  assert.equal(canSetRole(mod, admin, 'PLAYER'), false);
  assert.equal(canSetRole(mod, mod, 'PLAYER'), false);
  assert.equal(canSetRole(admin, player, 'MOD'), false);
  assert.equal(canSetRole(owner2, player, 'ADMIN'), true);
  assert.equal(canSetRole(owner2, player, 'OWNER'), false);
  assert.equal(canSetRole(original, player, 'OWNER'), true);
  assert.equal(canSetRole(original, owner2, 'PLAYER'), true);
});

test('Influenciador: só OWNER concede; MOD não', () => {
  assert.equal(canManageInfluencer(owner2, player), true);
  assert.equal(canManageInfluencer(mod, player), false);
  assert.equal(canManageInfluencer(admin, player), false);
});

test('Moedas infinitas só para OWNER e MOD', () => {
  assert.equal(hasInfiniteCoins(original), true);
  assert.equal(hasInfiniteCoins(mod), true);
  assert.equal(hasInfiniteCoins(admin), false);
  assert.equal(hasInfiniteCoins(player), false);
});

test('allowedActions de ADMIN sobre PLAYER: só expulsar', () => {
  assert.deepEqual(allowedActions(admin, player), { kick: true, ban: false, unban: false, mute: false, roles: [], influencer: false });
});
