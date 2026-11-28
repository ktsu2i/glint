package app

import (
	"context"
	"fmt"

	"github.com/wailsapp/wails/v3/pkg/application"
)

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

type wailsDialogs struct{ app *application.App }

func (d wailsDialogs) chooseBookFile(ctx context.Context, title string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	path, err := d.app.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		Title:           title,
		CanChooseFiles:  true,
		ResolvesAliases: true,
		Filters: []application.FileFilter{
			{DisplayName: "Books (*.pdf;*.epub)", Pattern: "*.pdf;*.epub"},
			{DisplayName: "PDF files (*.pdf)", Pattern: "*.pdf"},
			{DisplayName: "EPUB files (*.epub)", Pattern: "*.epub"},
		},
	}).PromptForSingleSelection()
	if err != nil {
		return "", fmt.Errorf("open book dialog: %w", err)
	}
	return path, nil
}

func (d wailsDialogs) confirm(ctx context.Context, request confirmation) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	response := make(chan bool, 1)
	dialog := d.app.Dialog.Question().SetTitle(request.title).SetMessage(request.message)
	dialog.AddButton(request.accept).OnClick(func() { response <- true })
	dialog.AddButton(request.cancel).SetAsDefault().SetAsCancel().OnClick(func() { response <- false })
	dialog.Show()
	select {
	case accepted := <-response:
		return accepted, nil
	case <-ctx.Done():
		return false, ctx.Err()
	}
}
