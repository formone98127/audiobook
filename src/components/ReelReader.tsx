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
    if (!manualScroll && timings && sentences.length > 0) {
      const targetSentence = audioSentenceIndex;
      if (targetSentence !== currentSentence) {
        setCurrentSentence(targetSentence);
        scrollToSentence(targetSentence, false);
      }
    }
  }, [manualScroll, timings, sentences.length, audioSentenceIndex, currentSentence]);

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
    const sentenceHeight = windowHeight;
    const newSentence = Math.round(offsetY / sentenceHeight);

    if (newSentence !== currentSentence && newSentence >= 0 && newSentence < sentences.length) {
      setManualScroll(true);
      setCurrentSentence(newSentence);
      onProgress(newSentence);
      onSeek(newSentence);

      // Auto-resume audio sync after a delay
      setTimeout(() => setManualScroll(false), 2000);
    }
  };

  const scrollToSentence = (index: number, animated = true) => {
    if (scrollViewRef.current && index >= 0 && index < sentences.length) {
      scrollViewRef.current.scrollTo({
        y: index * windowHeight,
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
        pagingEnabled
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        snapToInterval={windowHeight}
        decelerationRate="fast"
      >
        {sentences.map((sentence, index) => (
          <View
            key={index}
            style={[styles.sentenceCard, { height: windowHeight }]}
          >
            <Pressable
              style={styles.sentenceContainer}
              onPress={() => {
                if (index === currentSentence) {
                  onPlayPause();
                } else {
                  scrollToSentence(index);
                }
              }}
            >
              <Text style={[styles.sentenceText, { fontSize }]}>
                {sentence}
              </Text>
              {index === currentSentence && (
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
              )}
            </Pressable>
          </View>
        ))}
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
    sentenceCard: {
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    sentenceContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      width: '100%',
    },
    sentenceText: {
      fontFamily: Fonts.display,
      color: colors.fg,
      textAlign: 'center',
      lineHeight: fontSize * 1.6,
      paddingHorizontal: 20,
    },
    progressBar: {
      position: 'absolute',
      bottom: 40,
      left: 20,
      right: 20,
      height: 3,
      backgroundColor: colors.border,
      borderRadius: 2,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
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