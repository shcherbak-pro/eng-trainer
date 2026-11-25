# Makes a synthetic speech clip for the browser acceptance test (ENG-V3-02, stage A):
# one phrase, spoken by a Windows text-to-speech voice, as a 16 kHz mono 16-bit WAV file.
#
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/acceptance/make-speech.ps1 -Out .local/acceptance/clip.wav
#
# Run it with Windows PowerShell 5.1: System.Speech is not part of PowerShell 7.
# The clip starts with a short silence. A test microphone plays it from the moment the browser
# opens the device, a moment before the recorder listens, as a person waits before speaking.
# The clip is test data, made on this computer. It is not a recording of a person, and it
# is written to an ignored folder, never to the repository. On another system, any
# 16 kHz mono 16-bit WAV of one clearly spoken phrase can be used in its place.
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Text = 'I would like to clarify the requirements before we start.',
  [string]$Voice = '',
  [int]$LeadMilliseconds = 600
)

Add-Type -AssemblyName System.Speech
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voices = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'en-*' } | ForEach-Object { $_.VoiceInfo.Name }
  if (-not $voices) { throw 'No English text-to-speech voice is installed.' }
  $chosen = if ($Voice) { $Voice } else { @($voices)[0] }
  $synth.SelectVoice($chosen)
  $synth.Rate = -1

  $folder = Split-Path -Parent $Out
  if ($folder) { New-Item -ItemType Directory -Force $folder | Out-Null }
  $prompt = New-Object System.Speech.Synthesis.PromptBuilder
  $prompt.AppendBreak([TimeSpan]::FromMilliseconds($LeadMilliseconds))
  $prompt.AppendText($Text)
  $synth.SetOutputToWaveFile($Out, $format)
  $synth.Speak($prompt)
  $synth.SetOutputToNull()
  "Voice: $chosen"
  "Text:  $Text (after $LeadMilliseconds ms of silence)"
  "File:  $Out ($((Get-Item $Out).Length) bytes)"
} finally {
  $synth.Dispose()
}
