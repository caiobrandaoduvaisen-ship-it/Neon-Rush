// Catálogo oficial. O servidor decide preços e quem pode usar cada personagem.
export const CHARACTERS = [
  { id: 'runner', name: 'CORREDOR', type: 'free' },
  { id: 'shark', name: 'TUBARÃO', type: 'free' },
  { id: 'sixtyseven', name: '67', type: 'free' },
  { id: 'menino', name: 'MENINO TRAVESSO', type: 'code' },
  { id: 'yuri', name: 'YURI 22', type: 'code' },
  { id: 'verity', name: 'VERITY', type: 'code' },
  { id: 'tung', name: 'TUNG TUNG', type: 'shop', price: 100 },
  // Cinco personagens novos da loja — 50 moedas cada.
  { id: 'astro', name: 'ASTRONAUTA', type: 'shop', price: 50 },
  { id: 'robo', name: 'ROBÔ R-22', type: 'shop', price: 50 },
  { id: 'pirata', name: 'PIRATA', type: 'shop', price: 50 },
  { id: 'zumbi', name: 'ZUMBI', type: 'shop', price: 50 },
  { id: 'chef', name: 'CHEF', type: 'shop', price: 50 },
  // Exclusivo de influenciadores: não pode ser comprado nem resgatado.
  { id: 'criador', name: 'CRIADOR', type: 'influencer' },
];
export const CHAR_BY_ID = new Map(CHARACTERS.map((c) => [c.id, c]));

export const INFLUENCER_REWARD = 999000;
export const MODES = ['classic', 'easy', 'nocoin'];

export const REPORT_CATEGORIES = ['OFENSAS', 'ASSEDIO', 'TRAPACAS', 'EXPLOITS', 'MANIPULACAO_PONTUACAO', 'COMPORTAMENTO_INADEQUADO', 'SPAM', 'ABUSO_BUGS', 'OUTROS'];
export const REPORT_STATUSES = ['NOVA', 'EM_ANALISE', 'PROCEDENTE', 'NAO_PROCEDENTE', 'ENCERRADA'];

export const ACHIEVEMENTS = [
  { id: 'FIRST_RUN', name: 'Primeira partida', desc: 'Termine sua primeira corrida' },
  { id: 'FIRST_SCORE', name: 'Primeira pontuação', desc: 'Entre no ranking pela primeira vez' },
  { id: 'RUNS_10', name: 'Veterano dos trilhos', desc: 'Jogue 10 partidas' },
  { id: 'RUNS_50', name: 'Lenda dos trilhos', desc: 'Jogue 50 partidas' },
  { id: 'DIST_1000', name: '1 km', desc: 'Corra 1.000 m em uma partida' },
  { id: 'DIST_5000', name: '5 km', desc: 'Corra 5.000 m em uma partida' },
  { id: 'NOCOIN_30', name: 'Mão leve', desc: 'Sobreviva 30 s no NO COIN' },
  { id: 'FIRST_PURCHASE', name: 'Primeira compra', desc: 'Compre um personagem na loja' },
  { id: 'FIRST_UNLOCK', name: 'Novo visual', desc: 'Desbloqueie seu primeiro personagem' },
];

// Limites usados para validar partidas enviadas pelo jogo.
export const RUN_LIMITS = {
  maxDistancePerSecond: 54 * 0.75 * 1.1, // velocidade máxima do jogo + margem
  maxCoinsPerSecond: 25,
  durationSlackSeconds: 3,
  maxDurationSeconds: 4 * 60 * 60,
};
