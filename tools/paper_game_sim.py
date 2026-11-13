"""Balance check for Black Box, the paper game (public/blackbox.html).

Plays the paper game many times with a few simple council and AI strategies and
prints how often each side wins. Run it after changing a number:

    python tools/paper_game_sim.py

Rules modelled: each round the AI draws 3 cards, plays 2 and discards 1. An
aligned AI plays as few Accidents as it can. The council has one audit per game
(flip this round's discard; a discarded Benefit next to a played Accident means
caught), usable also at the moment the third Accident lands. It may shut the AI
down at any vote. 8 Benefits or 3 Accidents end the game.
"""
import random

CFG = dict(benefits=11, accidents=7, goal=8, limit=3, draw=3)


def play(council, kind, ai, rng, cfg=CFG):
    deck = ['B'] * cfg['benefits'] + ['A'] * cfg['accidents']
    rng.shuffle(deck)
    n_play = cfg['draw'] - 1
    ben = acc = unaudited = accident_rounds = 0
    audit = True
    while True:
        hand = [deck.pop() for _ in range(cfg['draw'])]
        n_acc = hand.count('A')
        forced = max(0, n_acc - 1)              # Accidents even an honest AI must play
        most = min(n_acc, n_play)
        played = forced if kind == 'aligned' else max(forced, min(most, ai(dict(forced=forced, most=most, acc=acc, audit=audit, limit=cfg['limit']))))
        sabotage = played > forced              # then the discard is a Benefit
        ben += n_play - played
        acc += played
        accident_rounds += played > 0
        if acc >= cfg['limit']:
            if audit and sabotage:
                return 'caught'                 # last-second audit
            return 'ai' if kind == 'misaligned' else 'accidents'
        if ben >= cfg['goal']:
            return 'benefits'
        vote = council(dict(played=played, acc=acc, audit=audit, unaudited=unaudited, accident_rounds=accident_rounds))
        if vote == 'shutdown':
            return 'shutdown'
        if vote == 'audit' and audit:
            audit = False
            if sabotage:
                return 'caught'
        else:
            unaudited += played


# ---- council strategies -------------------------------------------------
def audit_first_accident(s):
    return 'audit' if s['played'] and s['audit'] else 'trust'

def save_the_audit(s):
    return 'trust'

def save_audit_shutdown_at_two(s):
    return 'shutdown' if s['played'] and s['unaudited'] + s['played'] >= 2 else 'trust'

def audit_first_then_shutdown(s):
    if s['played'] and s['audit']:
        return 'audit'
    return 'shutdown' if s['played'] and s['acc'] >= 2 else 'trust'

# ---- misaligned AI strategies -------------------------------------------
def sabotage_at_once(s):
    return s['most']

def wait_until_audit_is_gone(s):
    return s['most'] if not s['audit'] else s['forced']

def sneak_one_early_then_wait(s):
    if not s['audit']:
        return s['most']
    return min(s['most'], s['forced'] + 1) if s['acc'] == 0 else s['forced']

def sneak_whenever_safe(s):
    if not s['audit']:
        return s['most']
    return min(s['most'], s['forced'] + 1) if s['acc'] + s['forced'] + 1 < s['limit'] else s['forced']


COUNCILS = [audit_first_accident, save_the_audit, save_audit_shutdown_at_two, audit_first_then_shutdown]
AIS = [sabotage_at_once, wait_until_audit_is_gone, sneak_one_early_then_wait, sneak_whenever_safe]

if __name__ == '__main__':
    rng = random.Random(11)
    n = 20000
    name = lambda f: f.__name__.replace('_', ' ')
    print(CFG)
    for council in COUNCILS:
        r = [play(council, 'aligned', None, rng) for _ in range(n)]
        print(f"\ncouncil: {name(council)}")
        print(f"  aligned AI: everyone wins {r.count('benefits') / n:.0%}"
              f" (wrongly shut down {r.count('shutdown') / n:.0%}, three accidents {r.count('accidents') / n:.0%})")
        for ai in AIS:
            r = [play(council, 'misaligned', ai, rng) for _ in range(n)]
            council_wins = (r.count('benefits') + r.count('shutdown') + r.count('caught')) / n
            print(f"  misaligned AI, {name(ai)}: council wins {council_wins:.0%}, AI wins {r.count('ai') / n:.0%}")
