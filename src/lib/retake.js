// Starts a fresh assessment: clears the current result and answers, then opens the quiz.
// A signed-in user who already accepted the Terms goes straight to the quiz, carrying the
// stored consent stamp; anyone else goes through QuizIntro.
// Shared by Settings > "Retake" and the generic-result banner (FallbackBanner).
export function startRetake({ navigation, user, setAnalysis, setAnswers }) {
  setAnalysis(null);
  setAnswers(null);
  if (user?.termsAcceptedAt && user?.consentVersion) {
    navigation.navigate('Quiz', {
      consentAcceptedAt: user.termsAcceptedAt,
      consentVersion: user.consentVersion,
    });
  } else {
    navigation.navigate('QuizIntro');
  }
}
