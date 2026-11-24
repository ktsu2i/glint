package app

import (
	"context"
	"fmt"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// dialogs opens native dialogs. Tests replace it with a fake.
type dialogs interface {
	chooseBookFile(ctx context.Context, title string) (string, error)
	confirm(ctx context.Context, request confirmation) (bool, error)
}

type confirmation struct {
	title   string
	message string
	accept  string
	cancel  string
}

type wailsDialogs struct{}

func (wailsDialogs) chooseBookFile(ctx context.Context, title string) (string, error) {
	path, err := runtime.OpenFileDialog(ctx, runtime.OpenDialogOptions{
		Title: title,
		Filters: []runtime.FileFilter{
			{DisplayName: "Books (*.pdf;*.epub)", Pattern: "*.pdf;*.epub"},
			{DisplayName: "PDF files (*.pdf)", Pattern: "*.pdf"},
			{DisplayName: "EPUB files (*.epub)", Pattern: "*.epub"},
		},
	})
	if err != nil {
		return "", fmt.Errorf("open book dialog: %w", err)
	}
	return path, nil
}

func (wailsDialogs) confirm(ctx context.Context, request confirmation) (bool, error) {
	response, err := runtime.MessageDialog(ctx, runtime.MessageDialogOptions{
		Type:          runtime.QuestionDialog,
		Title:         request.title,
		Message:       request.message,
		Buttons:       []string{request.accept, request.cancel},
		DefaultButton: request.cancel,
		CancelButton:  request.cancel,
	})
	if err != nil {
		return false, err
	}
	return response == request.accept, nil
}
