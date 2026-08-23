import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { Fonts, type Palette } from '@/constants/lumina';
import type { TimingIndex } from '@/lib/timing';

type Props = {
  sentences: string[];
  timings: TimingIndex | null;
  onProgress: (sentenceIndex: number) => void;
  onChapterComplete: () => void;
  fontSize: number;
  colors: Palette;
  playing: boolean;
  currentTime: number;
  onPlayPause: () => void;
  onSeek: (sentenceIndex: number) => void;
};

const VISIBLE_SENTENCES = 3; // Show 3 paragraphs at once for better context

export function ReelReader({
  sentences,
  timings,
  onProgress,
  onChapterComplete,
  fontSize,
  colors,
  playing,
  currentTime,
  onPlayPause,
  onSeek,
}: Props) {
  const { height: windowHeight } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors, fontSize), [colors, fontSize]);

  const [currentSentence, setCurrentSentence] = useState(0);
  const [manualScroll, setManualScroll] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const currentIndexRef = useRef(0);
  const progressRef = useRef(0);

  // Calculate which sentence should be active based on audio timings
  const audioSentenceIndex = useMemo(() => {
    if (!timings || sentences.length === 0) return 0;
    const sentenceIdx = timings.sentenceAt(currentTime);
    return Math.max(0, Math.min(sentences.length - 1, sentenceIdx >= 0 ? sentenceIdx : 0));
  }, [timings, currentTime, sentences.length]);

  currentIndexRef.current = currentSentence;

  // Sync with audio when not manually scrolling
  useEffect(() => {
    if (!manualScroll && timings && sentences.length > 0 && audioSentenceIndex !== currentSentence) {
      const targetSentence = audioSentenceIndex;
      setCurrentSentence(targetSentence);
      scrollToSentence(targetSentence, true); // Use smooth animation for auto-scroll

      // Clear manual scroll mode more quickly for better audio sync
      if (manualScroll) {
        setTimeout(() => setManualScroll(false), 500);
      }
    }
  }, [manualScroll, timings, sentences.length, audioSentenceIndex, currentSentence]);

  // Enhanced audio sync - check more frequently
  useEffect(() => {
    if (!playing || !timings || sentences.length === 0) return;

    const checkInterval = setInterval(() => {
      const targetSentence = audioSentenceIndex;
      if (targetSentence !== currentSentence && !manualScroll) {
        setCurrentSentence(targetSentence);
        scrollToSentence(targetSentence, false); // Quick snap for audio sync
      }
    }, 100); // Check every 100ms for smoother sync

    return () => clearInterval(checkInterval);
  }, [playing, timings, sentences.length, audioSentenceIndex, currentSentence, manualScroll]);

  // Update progress bar
  useEffect(() => {
    if (timings && currentSentence >= 0 && currentSentence < sentences.length) {
      const sentenceStart = timings.sentenceStartOf(currentSentence);
      const sentenceEnd = timings.sentenceStartOf(currentSentence + 1);
      const duration = sentenceEnd - sentenceStart;
      const elapsed = currentTime - sentenceStart;

      if (duration > 0) {
        const progress = Math.max(0, Math.min(1, elapsed / duration));
        progressRef.current = progress;
      }
    }
  }, [currentTime, currentSentence, timings, sentences.length]);

  const handleScroll = (event: any) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    const sentenceHeight = windowHeight / VISIBLE_SENTENCES;
    const newSentence = Math.round(offsetY / sentenceHeight);

    if (newSentence !== currentSentence && newSentence >= 0 && newSentence < sentences.length) {
      setManualScroll(true);
      setCurrentSentence(newSentence);
      onProgress(newSentence);
      onSeek(newSentence);

      // Auto-resume audio sync after a shorter delay for better responsiveness
      setTimeout(() => setManualScroll(false), 1000);
    }
  };

  const scrollToSentence = (index: number, animated = true) => {
    if (scrollViewRef.current && index >= 0 && index < sentences.length) {
      const sentenceHeight = windowHeight / VISIBLE_SENTENCES;
      // Calculate the target scroll position to center the current sentence
      const targetY = (index * sentenceHeight) - (windowHeight / 2) + (sentenceHeight / 2);

      scrollViewRef.current.scrollTo({
        y: Math.max(0, Math.min(targetY, (sentences.length * sentenceHeight) - windowHeight)),
        animated,
      });
    }
  };

  const nextSentence = () => {
    if (currentSentence < sentences.length - 1) {
      scrollToSentence(currentSentence + 1);
    } else {
      onChapterComplete();
    }
  };

  const prevSentence = () => {
    if (currentSentence > 0) {
      scrollToSentence(currentSentence - 1);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        pagingEnabled={false}
        showsVerticalScrollIndicator={true}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        decelerationRate="normal"
        bounces={false}
      >
        {sentences.map((sentence, index) => {
          const isCurrent = index === currentSentence;
          const opacity = isCurrent ? 1 : 0.3;
          const scale = isCurrent ? 1.2 : 0.9;
          const backgroundColor = isCurrent ? colors.accent + '20' : 'transparent';
          const borderColor = isCurrent ? colors.accent : 'transparent';
          const sentenceHeight = Math.max(windowHeight / VISIBLE_SENTENCES, 120); // Minimum height for paragraph readability

          return (
            <View
              key={index}
              style={[
                styles.sentenceItem,
                {
                  minHeight: sentenceHeight,
                  opacity,
                  backgroundColor,
                  borderWidth: isCurrent ? 2 : 0,
                  borderColor,
                  borderRadius: isCurrent ? 10 : 0,
                  paddingVertical: isCurrent ? 32 : 20,
                  marginVertical: isCurrent ? 12 : 6,
                }
              ]}
            >
              <Pressable
                style={styles.sentencePressable}
                onPress={() => {
                  if (index === currentSentence) {
                    onPlayPause();
                  } else {
                    scrollToSentence(index);
                  }
                }}
              >
                <Text
                  style={[
                    styles.sentenceText,
                    {
                      fontSize: isCurrent ? Math.min(fontSize * 1.3, 36) : Math.max(fontSize * 0.9, 16),
                      fontWeight: isCurrent ? '700' : '400',
                      color: isCurrent ? colors.accent : colors.fg,
                      lineHeight: isCurrent ? fontSize * 1.8 : fontSize * 1.6,
                      letterSpacing: isCurrent ? 0.8 : 0.4,
                      textShadowColor: isCurrent ? colors.accent : 'transparent',
                      textShadowOffset: isCurrent ? { width: 0, height: 0 } : undefined,
                      textShadowRadius: isCurrent ? 8 : 0,
                      opacity: isCurrent ? 1 : 0.7,
                    }
                  ]}
                >
                  {sentence}
                </Text>
                {isCurrent && (
                  <>
                    <View style={styles.progressBar}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            backgroundColor: colors.accent,
                            width: `${progressRef.current * 100}%`,
                          },
                        ]}
                      />
                    </View>
                    <View style={styles.glowEffect}>
                      <View style={[styles.glow, { backgroundColor: colors.accent }]} />
                    </View>
                  </>
                )}
              </Pressable>
            </View>
          );
        })}
      </ScrollView>

      {/* Controls Overlay */}
      <View style={styles.controls}>
        <View style={styles.progressInfo}>
          <Text style={styles.progressText}>
            {currentSentence + 1} / {sentences.length}
          </Text>
        </View>

        <View style={styles.controlButtons}>
          <Pressable
            style={[styles.controlBtn, { borderColor: colors.border }]}
            onPress={prevSentence}
            disabled={currentSentence === 0}
          >
            <Text style={[styles.controlBtnText, { color: colors.fg }]}>↑</Text>
          </Pressable>

          <Pressable
            style={[styles.controlBtn, styles.playBtn, { borderColor: colors.fg }]}
            onPress={onPlayPause}
          >
            <Text style={[styles.playBtnText, { color: colors.fg }]}>
              {playing ? '❚❚' : '▶'}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.controlBtn, { borderColor: colors.border }]}
            onPress={nextSentence}
            disabled={currentSentence === sentences.length - 1}
          >
            <Text style={[styles.controlBtnText, { color: colors.fg }]}>↓</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function makeStyles(colors: Palette, fontSize: number) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    scrollView: {
      flex: 1,
    },
    sentenceItem: {
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
      marginHorizontal: 20,
      marginVertical: 6,
    },
    sentencePressable: {
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    sentenceText: {
      fontFamily: Fonts.display,
      textAlign: 'left',
      paddingHorizontal: 28,
      textAlignVertical: 'center',
    },
    progressBar: {
      position: 'absolute',
      bottom: -12,
      left: 20,
      right: 20,
      height: 4,
      backgroundColor: colors.border,
      borderRadius: 2,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
    },
    glowEffect: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
    },
    glow: {
      width: '80%',
      height: '80%',
      borderRadius: 20,
      opacity: 0.1,
    },
    controls: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingHorizontal: 20,
      paddingVertical: 16,
      gap: 12,
    },
    progressInfo: {
      alignItems: 'center',
    },
    progressText: {
      fontFamily: Fonts.mono,
      fontSize: 12,
      color: colors.muted,
      letterSpacing: 1,
    },
    controlButtons: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 12,
    },
    controlBtn: {
      width: 50,
      height: 50,
      borderRadius: 25,
      borderWidth: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'transparent',
    },
    playBtn: {
      width: 64,
      height: 64,
      borderRadius: 32,
      borderColor: colors.fg,
    },
    controlBtnText: {
      fontSize: 24,
      fontWeight: '600',
    },
    playBtnText: {
      fontSize: 18,
      fontWeight: '600',
    },
  });
}