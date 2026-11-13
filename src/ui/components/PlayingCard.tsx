import { memo } from 'react';
import { motion } from 'framer-motion';
import { type Card, rankOf, suitOf, RANK_CHARS, SUIT_SYMBOLS, RANK_NAMES } from '../../engine/cards';

const SUIT_NAMES = ['clubs', 'diamonds', 'hearts', 'spades'];

interface Props {
  card: Card | null;
  /** face down when false or when card is null */
  faceUp?: boolean;
  size?: 'sm' | 'md' | 'lg';
  dim?: boolean;
  highlight?: boolean;
  /** delay (s) for the flip animation */
  flipDelay?: number;
  className?: string;
}

/** A playing card drawn with CSS; flips in 3D (transform only). */
export const PlayingCard = memo(function PlayingCard({
  card, faceUp = true, size = 'md', dim = false, highlight = false, flipDelay = 0, className = '',
}: Props) {
  const up = faceUp && card !== null;
  const rank = card !== null ? RANK_CHARS[rankOf(card)] : '';
  const suit = card !== null ? suitOf(card) : 0;
  const label = card !== null && up ? `${RANK_NAMES[rankOf(card)]} of ${SUIT_NAMES[suit]}` : 'face-down card';
  return (
    <div
      className={`card card--${size} ${dim ? 'card--dim' : ''} ${highlight ? 'card--hl' : ''} ${className}`}
      role="img"
      aria-label={label}
    >
      <motion.div
        className="card__inner"
        initial={false}
        animate={{ rotateY: up ? 0 : 180 }}
        transition={{ duration: 0.38, delay: flipDelay, ease: [0.3, 0.7, 0.3, 1] }}
      >
        <div className={`card__face card__front suit-${suit}`}>
          {card !== null && (
            <>
              <span className="card__rank">{rank === 'T' ? '10' : rank}</span>
              <span className="card__suit">{SUIT_SYMBOLS[suit]}</span>
              <span className="card__pip">{SUIT_SYMBOLS[suit]}</span>
            </>
          )}
        </div>
        <div className="card__face card__back" />
      </motion.div>
    </div>
  );
});
