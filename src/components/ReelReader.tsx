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
  onQuickSettings?: () => void;
};

const VISIBLE_SENTENCES = 4; // Show more paragraphs with tighter spacing

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
  onQuickSettings,
}: Props) {
  const { height: windowHeight } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors, fontSize), [colors, fontSize]);

  const [currentSentence, setCurrentSentence] = useState(0);
  const [manualScroll, setManualScroll] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const currentIndexRef = useRef(0);

  // Calculate which sentence should be active based on audio timings
  const audioSentenceIndex = useMemo(() => {
    if (!timings || sentences.length === 0) return 0;
    const sentenceIdx = timings.sentenceAt(currentTime);
    const result = Math.max(0, Math.min(sentences.length - 1, sentenceIdx >= 0 ? sentenceIdx : 0));
    console.log('audioSentenceIndex calculation - currentTime:', currentTime.toFixed(2), 'sentenceIdx:', sentenceIdx, 'result:', result, 'sentences.length:', sentences.length);
    return result;
  }, [timings, currentTime, sentences.length]);

  // Force update when audioSentenceIndex changes - but respect manual scroll
  useEffect(() => {
    if (audioSentenceIndex !== currentSentence && !manualScroll) {
      console.log('Forcing currentSentence update from', currentSentence, 'to', audioSentenceIndex);
      setCurrentSentence(audioSentenceIndex);
      scrollToSentence(audioSentenceIndex, true);
    } else if (manualScroll) {
      console.log('Skipping forced update - manual mode active');
    }
  }, [audioSentenceIndex, manualScroll]);

  currentIndexRef.current = currentSentence;

  // Enhanced audio sync - check more frequently but respect manual scroll
  useEffect(() => {
    if (!playing || !timings || sentences.length === 0) return;

    const checkInterval = setInterval(() => {
      // Only auto-scroll if not in manual mode
      if (!manualScroll) {
        const targetSentence = audioSentenceIndex;
        if (targetSentence !== currentSentence) {
          console.log('Auto-scrolling to paragraph:', targetSentence, 'from', currentSentence);
          setCurrentSentence(targetSentence);
          scrollToSentence(targetSentence, true); // Use smooth animation for auto-scroll
        }
      } else {
        console.log('Skipping auto-scroll - manual mode active');
      }
    }, 100); // Check every 100ms for smooth sync

    return () => clearInterval(checkInterval);
  }, [playing, timings, sentences.length, audioSentenceIndex, currentSentence, manualScroll]);

  const handleScroll = (event: any) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    const sentenceHeight = windowHeight / VISIBLE_SENTENCES;
    const newSentence = Math.round(offsetY / sentenceHeight);

    console.log('Scroll event - offsetY:', offsetY, 'calculated sentence:', newSentence, 'current:', currentSentence);

    if (newSentence !== currentSentence && newSentence >= 0 && newSentence < sentences.length) {
      console.log('Manual scroll detected - moving to paragraph:', newSentence);
      setManualScroll(true);
      setCurrentSentence(newSentence);
      onProgress(newSentence);
      onSeek(newSentence);
    }
  };

  const scrollToSentence = (index: number, animated = true) => {
    if (scrollViewRef.current && index >= 0 && index < sentences.length) {
      const sentenceHeight = windowHeight / VISIBLE_SENTENCES;
      // Calculate the target scroll position to center the current sentence
      const targetY = (index * sentenceHeight) - (windowHeight / 2) + (sentenceHeight / 2);

      const maxY = Math.max(0, (sentences.length * sentenceHeight) - windowHeight);
      const finalY = Math.max(0, Math.min(targetY, maxY));

      console.log('Scrolling to paragraph', index, 'at Y:', finalY);
      scrollViewRef.current.scrollTo({
        y: finalY,
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
        scrollEventThrottle={100}
        decelerationRate="normal"
        bounces={true}
        nestedScrollEnabled
      >
        {sentences.map((sentence, index) => {
          const isCurrent = index === currentSentence;

          return (
            <View
              key={index}
              style={[
                styles.sentenceItem,
                {
                  minHeight: Math.max(windowHeight / VISIBLE_SENTENCES, 80),
                  backgroundColor: isCurrent ? colors.bg : colors.bg,
                  paddingVertical: 6,
                  marginVertical: 1,
                  paddingHorizontal: 24,
                }
              ]}
            >
              <Pressable
                style={styles.sentencePressable}
                onPress={() => {
                  console.log('Pressed paragraph:', index);
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
                      fontSize: fontSize,
                      fontWeight: '400',
                      color: colors.fg,
                      lineHeight: fontSize * 1.6,
                    }
                  ]}
                >
                  {sentence}
                </Text>
                {isCurrent && (
                  <View style={styles.currentIndicator}>
                    <View style={[styles.indicatorDot, { backgroundColor: colors.accent }]} />
                  </View>
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

          {onQuickSettings && (
            <Pressable
              style={[styles.controlBtn, styles.quickSettingsBtn, { borderColor: colors.accent }]}
              onPress={onQuickSettings}
            >
              <Text style={[styles.quickSettingsText, { color: colors.accent }]}>⚡</Text>
            </Pressable>
          )}
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
      paddingVertical: 4,
      paddingHorizontal: 24,
      marginVertical: 0,
    },
    sentencePressable: {
      width: '100%',
    },
    sentenceText: {
      fontFamily: Fonts.display,
      textAlign: 'left',
      paddingHorizontal: 4,
    },
    currentIndicator: {
      position: 'absolute',
      left: 8,
      top: 28,
    },
    indicatorDot: {
      width: 4,
      height: 4,
      borderRadius: 2,
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
    quickSettingsBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
    },
    quickSettingsText: {
      fontSize: 20,
      fontWeight: '600',
    },
  });
}