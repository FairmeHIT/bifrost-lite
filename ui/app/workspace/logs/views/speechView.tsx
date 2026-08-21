import { useI18n } from "@/lib/i18n/context";
import { BifrostSpeech, SpeechInput } from "@/lib/types/logs";
import { AlertCircle, Play, Volume2 } from "lucide-react";
import React, { Component } from "react";
import AudioPlayer from "./audioPlayer";

interface SpeechViewProps {
	speechInput?: SpeechInput;
	speechOutput?: BifrostSpeech;
	isStreaming?: boolean;
}

// Error boundary specifically for audio player errors
interface AudioErrorBoundaryProps {
	children: React.ReactNode;
	t: (path: string, params?: Record<string, string | number>) => string;
}

class AudioErrorBoundary extends Component<AudioErrorBoundaryProps, { hasError: boolean; error: Error | null }> {
	constructor(props: AudioErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error) {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		console.error("Audio player error:", error, errorInfo);
	}

	render() {
		if (this.state.hasError) {
			return (
				<div className="flex items-center gap-2 rounded-sm border border-red-200 bg-red-50 p-4 text-sm text-red-800">
					<AlertCircle className="h-4 w-4" />
					<span>
						{this.props.t("logs.failedToLoadAudioPlayer")}: {this.state.error?.message || this.props.t("logs.unknownError")}
					</span>
				</div>
			);
		}

		return this.props.children;
	}
}

export default function SpeechView({ speechInput, speechOutput, isStreaming }: SpeechViewProps) {
	const { t } = useI18n();
	return (
		<div className="space-y-4">
			{/* Speech Input */}
			{speechInput && (
				<div className="w-full rounded-sm border">
					<div className="flex items-center gap-2 border-b px-6 py-2 text-sm font-medium">
						<Volume2 className="h-4 w-4" />
						{t("logs.speechInput")}
					</div>
					<div className="space-y-4 p-6">
						<div className="font-mono text-xs">{speechInput.input}</div>
					</div>
				</div>
			)}

			{/* Speech Output */}
			{(speechOutput || isStreaming) && (
				<div className="w-full rounded-sm border">
					<div className="flex items-center gap-2 border-b px-6 py-2 text-sm font-medium">
						<Play className="h-4 w-4" />
						{t("logs.speechOutput")}
					</div>
					<div className="space-y-4 p-6">
						<AudioErrorBoundary t={t}>
							<AudioPlayer src={speechOutput?.audio || ""} />
						</AudioErrorBoundary>
					</div>
				</div>
			)}
		</div>
	);
}