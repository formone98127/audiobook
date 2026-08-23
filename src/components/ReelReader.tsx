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

const VISIBLE_SENTENCES = 5; // Show 5 paragraphs for context, snap between them

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
  const scrollViewRef = useRef<ScrollView>(null);
  const currentIndexRef = useRef(0);

  // Calculate which paragraph should be active based on audio timings
  const audioParagraphIndex = useMemo(() => {
    if (!timings || sentences.length === 0) return 0;
    const sentenceIdx = timings.sentenceAt(currentTime);
    // Convert sentence index to paragraph index (approx 3 sentences per paragraph)
    const paragraphIdx = sentenceIdx >= 0 ? Math.floor(sentenceIdx / 3) : 0;
    const result = Math.max(0, Math.min(sentences.length - 1, paragraphIdx));
    console.log('audioParagraphIndex calculation - currentTime:', currentTime.toFixed(2), 'sentenceIdx:', sentenceIdx, 'paragraphIdx:', paragraphIdx, 'result:', result, 'sentences.length:', sentences.length);
    return result;
  }, [timings, currentTime, sentences.length]);

  // Force update when audioParagraphIndex changes
  useEffect(() => {
    if (audioParagraphIndex !== currentSentence) {
      console.log('Auto-scrolling to follow audio:', currentSentence, '->', audioParagraphIndex);
      setCurrentSentence(audioParagraphIndex);
      scrollToParagraph(audioParagraphIndex, true);
    }
  }, [audioParagraphIndex]);

  currentIndexRef.current = currentSentence;

  // Enhanced audio sync - reduced frequency for better performance
  useEffect(() => {
    if (!playing || !timings || sentences.length === 0) return;

    const checkInterval = setInterval(() => {
      const targetParagraph = audioParagraphIndex;
      if (targetParagraph !== currentSentence) {
        console.log('Auto-scrolling to paragraph:', targetParagraph);
        setCurrentSentence(targetParagraph);
        scrollToParagraph(targetParagraph, false); // Faster snap for auto-scroll
      }
    }, 200); // Reduced from 100ms to 200ms for better performance

    return () => clearInterval(checkInterval);
  }, [playing, timings, sentences.length, audioParagraphIndex, currentSentence]);

  const handleScroll = (event: any) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    const paragraphHeight = fontSize * 2.4;
    const newParagraph = Math.round(offsetY / paragraphHeight);

    // Update current paragraph based on scroll position
    if (newParagraph !== currentSentence && newParagraph >= 0 && newParagraph < sentences.length) {
      console.log('Scroll to paragraph:', newParagraph);
      setCurrentSentence(newParagraph);
      onProgress(newParagraph);
      onSeek(newParagraph);
    }
  };

  const handleScrollEnd = () => {
    console.log('Scroll ended - re-enabling auto-scroll');
    setManualScroll(false);
  };

  const handleMomentumScrollEnd = () => {
    console.log('Momentum scroll ended - ensuring auto-scroll is enabled');
    setManualScroll(false);
  };

  const scrollToSentence = (index: number, animated = true) => {
    if (scrollViewRef.current && index >= 0 && index < sentences.length) {
      const sentenceHeight = windowHeight / VISIBLE_SENTENCES;
      const targetY = (index * sentenceHeight) - (windowHeight / 2) + (sentenceHeight / 2);
      const maxY = Math.max(0, (sentences.length * sentenceHeight) - windowHeight);
      const finalY = Math.max(0, Math.min(targetY, maxY));
      console.log('Scrolling to paragraph', index, 'at Y:', finalY);
      scrollViewRef.current.scrollTo({ y: finalY, animated });
    }
  };

  const scrollToParagraph = (index: number, animated = true) => {
    if (scrollViewRef.current && index >= 0 && index < sentences.length) {
      // Snap to exact paragraph position for Reels-style behavior
      const paragraphHeight = fontSize * 2.4; // Text + margin height
      const targetY = index * paragraphHeight;
      const finalY = Math.max(0, targetY);
      console.log('Snapping to paragraph', index, 'at Y:', finalY);
      scrollViewRef.current.scrollTo({ y: finalY, animated });
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
        decelerationRate="fast"
        bounces={true}
      >
        <View style={styles.contentContainer}>
          {sentences.map((sentence, index) => {
            const isCurrent = index === currentSentence;

            return (
              <Text
                key={index}
                style={[
                  styles.sentenceText,
                  {
                    fontSize: fontSize,
                    fontWeight: isCurrent ? '700' : '400',
                    color: isCurrent ? colors.accent : colors.fg,
                    lineHeight: fontSize * 1.6,
                    marginBottom: fontSize * 0.8,
                    opacity: isCurrent ? 1 : (index > currentSentence ? 0.3 : 0.7),
                    backgroundColor: isCurrent ? colors.accent + '10' : 'transparent',
                    padding: isCurrent ? 12 : 0,
                    borderRadius: isCurrent ? 6 : 0,
                    minHeight: fontSize * 1.6,
                  }
                ]}
              >
                {sentence}
              </Text>
            );
          })}
        </View>
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
    contentContainer: {
      padding: 20,
      paddingBottom: 200,
    },
    sentenceText: {
      fontFamily: Fonts.display,
      textAlign: 'left',
      paddingHorizontal: 4,
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