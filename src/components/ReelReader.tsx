import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { Fonts, type Palette } from '@/constants/lumina';

type Props = {
  sentences: string[];
  onProgress: (sentenceIndex: number) => void;
  onChapterComplete: () => void;
  fontSize: number;
  colors: Palette;
  playing: boolean;
  onPlayPause: () => void;
  onSeek: (sentenceIndex: number) => void;
  onQuickSettings?: () => void;
  currentParagraph?: number;
};

export function ReelReader({
  sentences,
  onProgress,
  onChapterComplete,
  fontSize,
  colors,
  playing,
  onPlayPause,
  onSeek,
  onQuickSettings,
  currentParagraph = 0,
}: Props) {
  const { height: windowHeight } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors, fontSize), [colors, fontSize]);

  const [currentSentence, setCurrentSentence] = useState(currentParagraph);
  const scrollViewRef = useRef<ScrollView>(null);
  const manualScrollRef = useRef<boolean>(false); // Track if scroll was user-initiated
  const paragraphHeight = fontSize * 2.4; // Text + margin height

  // Scroll to paragraph function - stable reference
  const scrollToParagraph = useCallback((index: number, animated = true) => {
    if (scrollViewRef.current && index >= 0 && index < sentences.length) {
      const targetY = index * paragraphHeight;
      console.log('Scrolling to paragraph', index, 'at Y:', targetY);
      scrollViewRef.current.scrollTo({ y: targetY, animated });
    }
  }, [paragraphHeight, sentences.length]);

  // Track pending seek to execute on scroll end
  const pendingSeekRef = useRef<number | null>(null);

  // Handle scroll events - only when user manually scrolls
  const handleScroll = useCallback((event: any) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    const newParagraph = Math.round(offsetY / paragraphHeight);

    if (newParagraph !== currentSentence && newParagraph >= 0 && newParagraph < sentences.length) {
      console.log('Manual scroll to paragraph:', newParagraph);
      manualScrollRef.current = true; // Mark as user-initiated
      pendingSeekRef.current = newParagraph; // Store for seek on scroll end
      setCurrentSentence(newParagraph);
      onProgress(newParagraph);
    }
  }, [currentSentence, paragraphHeight, sentences.length, onProgress]);

  // Seek audio when scrolling ends
  const handleScrollEnd = useCallback(() => {
    if (pendingSeekRef.current !== null) {
      console.log('Scroll ended - seeking audio to paragraph:', pendingSeekRef.current);
      onSeek(pendingSeekRef.current);
      pendingSeekRef.current = null;
    }
  }, [onSeek]);

  // Sync local state with prop changes (from parent audio sync)
  useEffect(() => {
    console.log('=== SYNC CHECK === currentParagraph:', currentParagraph, 'currentSentence:', currentSentence, 'manualScroll:', manualScrollRef.current);
    if (currentParagraph !== currentSentence) {
      if (!manualScrollRef.current) {
        // Audio-driven sync - apply it
        console.log('>>> Audio sync triggered: updating to paragraph', currentParagraph);
        setCurrentSentence(currentParagraph);
        setTimeout(() => scrollToParagraph(currentParagraph, true), 100);
      } else {
        // User manually scrolled - accept their position, already notified parent
        console.log('>>> User manual scroll detected, skipping auto-sync to paragraph:', currentParagraph);
        manualScrollRef.current = false; // Reset flag
        setCurrentSentence(currentParagraph); // Align with parent without forcing scroll
      }
    }
  }, [currentParagraph, currentSentence, scrollToParagraph]);

  const nextSentence = () => {
    if (currentSentence < sentences.length - 1) {
      scrollToParagraph(currentSentence + 1);
    } else {
      onChapterComplete();
    }
  };

  const prevSentence = () => {
    if (currentSentence > 0) {
      scrollToParagraph(currentSentence - 1);
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
        onScrollEndDrag={handleScrollEnd}
        onMomentumScrollEnd={handleScrollEnd}
        scrollEventThrottle={100} // Throttle to reduce calls
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
